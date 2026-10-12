import assert from 'assert';
import presentAlert from '../../components/Alert';
import { BlueApp } from '../../class/blue-app';

jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const Realm = require('realm');
const Keychain = require('react-native-keychain');

const KEYVALUE_PATH = '/mock/Caches/keyvalue.realm';

describe('keyvalue realm keychain recovery when the old file cannot be removed', () => {
  const originalGet = Keychain.getGenericPassword.getMockImplementation();
  const originalDelete = Realm.deleteFile.getMockImplementation();

  afterEach(() => {
    Realm.deleteFile.mockImplementation(originalDelete);
    Keychain.getGenericPassword.mockImplementation(originalGet);
  });

  it('keeps the keychain entry and surfaces the error', async () => {
    Keychain.__mockKeychainHelpers.reset();
    Realm.__mockRealmHelpers.reset();
    const storage = new BlueApp();
    storage.wallets = [];
    await storage.saveToDisk();

    Keychain.resetGenericPassword.mockClear();
    (presentAlert as unknown as jest.Mock).mockClear();
    Realm.deleteFile.mockImplementation(() => {
      throw new Error('disk busy');
    });
    Keychain.getGenericPassword.mockImplementation(async (options: { service?: string }) => {
      if (options?.service === 'realm_encryption_key') throw new Error('Could not decrypt data with alias: realm_encryption_key');
      return originalGet(options);
    });

    await assert.rejects(storage.backupToRealmKeyValue('{}'), /Could not decrypt data with alias/);

    assert.strictEqual(Keychain.resetGenericPassword.mock.calls.length, 0, 'keychain entry kept');
    assert.ok(Realm.__mockRealmHelpers.store.get(KEYVALUE_PATH), 'old file still present');
  });
});
