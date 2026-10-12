import assert from 'assert';
import { BlueApp } from '../../class/blue-app';

jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const Realm = require('realm');
const Keychain = require('react-native-keychain');

describe('keyvalue realm startup read with unreadable keychain entry', () => {
  const originalGet = Keychain.getGenericPassword.getMockImplementation();

  beforeEach(() => {
    Keychain.__mockKeychainHelpers.reset();
    Realm.__mockRealmHelpers.reset();
    Realm.deleteFile.mockClear();
    Keychain.resetGenericPassword.mockClear();
    Keychain.getGenericPassword.mockReset();
    Keychain.getGenericPassword.mockImplementation(originalGet);
  });

  it('does not reset the keychain entry or delete the realm file, and rethrows the error', async () => {
    const storage = new BlueApp();
    storage.wallets = [];
    await storage.saveToDisk();

    Keychain.resetGenericPassword.mockClear();
    Realm.deleteFile.mockClear();
    Keychain.getGenericPassword.mockImplementation(async () => {
      throw new Error('Could not decrypt data with alias: realm_encryption_key');
    });
    storage.getItem = async () => {
      throw new Error('secure store unavailable');
    };

    await assert.rejects(storage.getItemWithFallbackToRealm('data'), /Could not decrypt data with alias/);

    assert.strictEqual(Keychain.resetGenericPassword.mock.calls.length, 0, 'keychain entry untouched');
    assert.strictEqual(Realm.deleteFile.mock.calls.length, 0, 'realm file untouched');
    assert.ok(Realm.__mockRealmHelpers.store.get('/mock/Caches/keyvalue.realm'), 'realm file still present');
  });
});
