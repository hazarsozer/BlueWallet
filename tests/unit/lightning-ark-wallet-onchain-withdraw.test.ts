import assert from 'assert';

import { LightningArkWallet } from '../../class/wallets/lightning-ark-wallet';
import { resetArkadeTestState } from '../helpers/arkadeMocks';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ONCHAIN_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

beforeEach(() => {
  resetArkadeTestState();
});

describe('LightningArkWallet — withdrawing to an on-chain Bitcoin address', () => {
  it('does not reject a plain on-chain address as an invalid Lightning request, and moves funds out via the Ark SDK', async () => {
    const w: any = new LightningArkWallet();
    w.setSecret('arkade://' + TEST_MNEMONIC);

    // Stub the SDK runtime: any spending call the wallet makes is recorded and succeeds.
    const spendCalls: string[] = [];
    const sdkWallet = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'then') return undefined;
          return jest.fn(async (...args: unknown[]) => {
            if (['sendBitcoin', 'settle', 'send', 'offboard'].includes(prop)) spendCalls.push(prop);
            return args.length ? 'txid' : {};
          });
        },
      },
    );
    const lightningPayments = jest.fn();
    w._wallet = sdkWallet;
    w._arkadeSwaps = { sendLightningPayment: lightningPayments };
    w._limitMin = 333;
    w._limitMax = 1_000_000;
    w.balance = 100_000;

    let error: Error | undefined;
    try {
      await w.payInvoice(ONCHAIN_ADDRESS, 50_000);
    } catch (e: any) {
      error = e;
    }

    // Users hold a balance but there is no way to send it to an on-chain address:
    // the wallet insists the destination is a Lightning invoice.
    assert.ok(!error || !/proper lightning payment request/i.test(error.message), `withdrawal rejected: ${error?.message}`);
    assert.ok(spendCalls.length > 0, 'expected the wallet to spend/offboard funds through the Ark SDK');
    assert.strictEqual(lightningPayments.mock.calls.length, 0, 'an on-chain withdrawal must not be attempted as a Lightning payment');
  });
});
