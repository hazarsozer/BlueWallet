import assert from 'assert';
import presentAlert from '../../components/Alert';
import { BlueApp } from '../../class/blue-app';

// Jest hoists this above the imports above.
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const Realm = require('realm');
const Keychain = require('react-native-keychain');

const KEYVALUE_PATH = '/mock/Caches/keyvalue.realm';
const presentAlertMock = presentAlert as unknown as jest.Mock;

describe('keyvalue realm keychain key recovery', () => {
  const originalOpen = Realm.open.getMockImplementation();
  const originalGet = Keychain.getGenericPassword.getMockImplementation();

  beforeEach(() => {
    Keychain.__mockKeychainHelpers.reset();
    Realm.__mockRealmHelpers.reset();
    Realm.open.mockReset();
    Realm.open.mockImplementation(originalOpen);
    Realm.deleteFile.mockClear();
    presentAlertMock.mockClear();
    Keychain.getGenericPassword.mockReset();
    Keychain.getGenericPassword.mockImplementation(originalGet);
  });

  it('recovers when the keychain entry realm_encryption_key can no longer be decrypted', async () => {
    const storage = new BlueApp();
    storage.wallets = [];
    await storage.saveToDisk();
    assert.strictEqual(presentAlertMock.mock.calls.length, 0);

    // The OS keystore entry became unreadable (e.g. restored device / rotated keystore key).
    // Every read fails until the stored entry is reset.
    let entryReset = false;
    Keychain.resetGenericPassword.mockImplementationOnce(async () => {
      entryReset = true;
      Keychain.__mockKeychainHelpers.reset();
      return true;
    });
    Keychain.getGenericPassword.mockImplementation(async (options: { service?: string }) => {
      if (!entryReset && options?.service === 'realm_encryption_key') {
        throw new Error('Could not decrypt data with alias: realm_encryption_key');
      }
      return originalGet(options);
    });

    await storage.saveToDisk();

    assert.strictEqual(
      presentAlertMock.mock.calls.length,
      0,
      `user must not be alerted, got: ${presentAlertMock.mock.calls.map((c: [{ message: string }]) => c[0].message).join(' | ')}`,
    );
    const realm = Realm.__mockRealmHelpers.store.get(KEYVALUE_PATH);
    const saved = [...realm.objects('KeyValue')].find((row: { key: string; value: string }) => row.key === 'data');
    assert.ok(saved?.value, 'backup was written after the keychain entry was recreated');
  });
});
