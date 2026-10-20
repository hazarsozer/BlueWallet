import assert from 'assert';

import { Estimator, Ramps } from '@arkade-os/sdk';

import { LightningArkWallet } from '../../class/wallets/lightning-ark-wallet';
import { resetArkadeTestState } from '../helpers/arkadeMocks';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ONCHAIN_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const OWN_ARK_ADDRESS = 'ark1own';

const makeVtxo = (value: number, extra: Record<string, unknown> = {}) => ({
  txid: 'aa'.repeat(32),
  vout: 0,
  value,
  status: { confirmed: true },
  virtualStatus: { state: 'settled' },
  createdAt: new Date(),
  isUnrolled: false,
  isSpent: false,
  ...extra,
});

const makeWallet = (vtxoValues: number[], intentFee: Record<string, string> = {}, vtxoExtra: Record<string, unknown> = {}) => {
  const settle = jest.fn(async () => 'txid');
  const sdkWallet = {
    getSpendableVtxos: jest.fn(async () => vtxoValues.map(v => makeVtxo(v, vtxoExtra))),
    getAddress: jest.fn(async () => OWN_ARK_ADDRESS),
    arkProvider: { getInfo: jest.fn(async () => ({ fees: { intentFee, txFeeRate: '1' } })) },
    settle,
  };
  const lightningPayments = jest.fn();
  const w: any = new LightningArkWallet();
  w.setSecret('arkade://' + TEST_MNEMONIC);
  w._wallet = sdkWallet;
  w._arkadeSwaps = { sendLightningPayment: lightningPayments };
  return { w, settle, lightningPayments };
};

beforeEach(() => {
  resetArkadeTestState();
});

describe('LightningArkWallet — on-chain withdrawal (collaborative exit)', () => {
  it('settles spendable vtxos to the destination for the requested amount, returning change to self', async () => {
    const { w, settle, lightningPayments } = makeWallet([100_000]);

    await w.payInvoice(ONCHAIN_ADDRESS, 50_000);

    assert.strictEqual(settle.mock.calls.length, 1);
    const [params] = settle.mock.calls[0] as any[];
    assert.ok(params.inputs.length > 0, 'settle must receive non-empty inputs');
    assert.deepStrictEqual(params.outputs[0], { address: ONCHAIN_ADDRESS, amount: 50_000n });
    assert.deepStrictEqual(params.outputs[1], { address: OWN_ARK_ADDRESS, amount: 50_000n });
    assert.strictEqual(lightningPayments.mock.calls.length, 0);
  });

  it('withdraws the whole balance without a change output', async () => {
    const { w, settle } = makeWallet([100_000]);

    await w.payInvoice(ONCHAIN_ADDRESS, 100_000);

    const [params] = settle.mock.calls[0] as any[];
    assert.strictEqual(params.outputs.length, 1);
    assert.deepStrictEqual(params.outputs[0], { address: ONCHAIN_ADDRESS, amount: 100_000n });
  });

  it('explains a dust remainder instead of forwarding an opaque error', async () => {
    const { w, settle } = makeWallet([100_000]);

    await assert.rejects(() => w.payInvoice(ONCHAIN_ADDRESS, 99_900), /remainder of 100 sat.*minimum/);
    assert.strictEqual(settle.mock.calls.length, 0);
  });

  it('deducts the server on-chain output fee from what the recipient receives', async () => {
    const { w, settle } = makeWallet([100_000], { onchainOutput: '200.0' });

    await w.payInvoice(ONCHAIN_ADDRESS, 50_000);

    const [params] = settle.mock.calls[0] as any[];
    assert.deepStrictEqual(params.outputs[0], { address: ONCHAIN_ADDRESS, amount: 49_800n });
    assert.deepStrictEqual(params.outputs[1], { address: OWN_ARK_ADDRESS, amount: 50_000n });
  });

  it('requires an amount', async () => {
    const { w, settle } = makeWallet([100_000]);

    await assert.rejects(() => w.payInvoice(ONCHAIN_ADDRESS, 0), /Amount is required/);
    assert.strictEqual(settle.mock.calls.length, 0);
  });

  it('with an input fee: max is the balance minus input fees, and recipient + change + fees equal the inputs', async () => {
    const fees = { offchainInput: '100.0', onchainOutput: '200.0' };
    const { w, settle } = makeWallet([100_000, 50_000], fees);

    assert.strictEqual(await w.getMaxOnchainWithdrawable(), 149_800);

    await w.payInvoice(ONCHAIN_ADDRESS, 100_000);

    const [params] = settle.mock.calls[0] as any[];
    const recipient = params.outputs[0].amount as bigint;
    const change = params.outputs[1].amount as bigint;
    assert.strictEqual(recipient, 99_800n);
    assert.strictEqual(change, 49_800n);
    const inputFees = 100n * BigInt(params.inputs.length);
    assert.strictEqual(recipient + change + 200n + inputFees, 150_000n);
  });

  it('rejects more than the balance net of input fees', async () => {
    const { w, settle } = makeWallet([100_000], { offchainInput: '100.0' });

    assert.strictEqual(await w.getMaxOnchainWithdrawable(), 99_900);
    await assert.rejects(() => w.payInvoice(ONCHAIN_ADDRESS, 100_000), /Insufficient balance/);
    assert.strictEqual(settle.mock.calls.length, 0);
  });

  it('fails closed when the spendable total is not a finite number', async () => {
    const { w, settle } = makeWallet([NaN]);
    w._wallet.arkProvider = undefined; // no fee estimator
    w.balance = NaN;

    assert.strictEqual(await w.getMaxOnchainWithdrawable(), 0);
    await assert.rejects(() => w.payInvoice(ONCHAIN_ADDRESS, 1_000), /Insufficient balance/);
    assert.strictEqual(settle.mock.calls.length, 0);
  });

  it('passes the vtxo expiry to the fee estimator the way the SDK does (expiresAt as is, else height * 1000 ms)', async () => {
    const spy = jest.spyOn(Estimator.prototype, 'evalOffchainInput');
    try {
      const expiresAt = new Date('2030-01-01T00:00:00Z');
      const withDate = makeWallet([100_000], { offchainInput: '100.0' }, { expiresAt });
      assert.strictEqual(await withDate.w.getMaxOnchainWithdrawable(), 99_900);
      assert.deepStrictEqual(spy.mock.calls.at(-1)![0].expiry, expiresAt);

      const withHeight = makeWallet([100_000], { offchainInput: '100.0' }, { expiresAtHeight: 900_000 });
      assert.strictEqual(await withHeight.w.getMaxOnchainWithdrawable(), 99_900);
      assert.deepStrictEqual(spy.mock.calls.at(-1)![0].expiry, new Date(900_000_000));

      const without = makeWallet([100_000], { offchainInput: '100.0' });
      await without.w.getMaxOnchainWithdrawable();
      assert.strictEqual(spy.mock.calls.at(-1)![0].expiry, undefined);
    } finally {
      spy.mockRestore();
    }
  });

  it('builds the same settle() call as the SDK Ramps.offboard, with and without server fees', async () => {
    const cases: [number[], Record<string, string>, number][] = [
      [[100_000], {}, 50_000],
      [[100_000, 50_000], { offchainInput: '100.0', onchainOutput: '200.0' }, 100_000],
      [[100_000, 50_000], { offchainInput: '100.0', onchainOutput: '200.0' }, 149_800],
    ];
    for (const [values, fees, amount] of cases) {
      const ours = makeWallet(values, fees, { expiresAtHeight: 900_000 });
      await ours.w.payInvoice(ONCHAIN_ADDRESS, amount);

      const sdk = makeWallet(values, fees, { expiresAtHeight: 900_000 });
      await new Ramps(sdk.w._wallet).offboard(ONCHAIN_ADDRESS, { intentFee: fees, txFeeRate: '1' }, BigInt(amount));

      const [a] = ours.settle.mock.calls[0] as any[];
      const [b] = sdk.settle.mock.calls[0] as any[];
      assert.deepStrictEqual(a.outputs, b.outputs);
      assert.strictEqual(a.inputs.length, b.inputs.length);
    }
  });
});
