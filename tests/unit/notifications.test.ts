import assert from 'assert';

import { setLevels, NOTIFICATIONS_NO_AND_DONT_ASK_FLAG } from '../../blue_modules/notifications';

const mockFetch = jest.fn();
jest.mock('../../util/fetch', () => ({
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  fetch: (...args: any[]) => mockFetch(...args),
}));

jest.mock('react-native-notifications', () => ({
  Notification: class {},
  NotificationBackgroundFetchResult: { NO_DATA: 'noData' },
  Notifications: {
    removeAllDeliveredNotifications: jest.fn(),
    ios: { setBadgeCount: jest.fn(), cancelAllLocalNotifications: jest.fn() },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage: Record<string, string> = {};
  return {
    __storage: storage,
    getItem: jest.fn((key: string) => Promise.resolve(key in storage ? storage[key] : null)),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
  };
});

const mockStorage: Record<string, string> = jest.requireMock('@react-native-async-storage/async-storage').__storage;

describe('notifications: enabling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
    mockStorage.PUSH_TOKEN = JSON.stringify({ token: 'device-token', os: 'android' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a failure when the server refuses to enable notifications for this device', async () => {
    // Server answers with an error, so this device is NOT subscribed to notifications.
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    // The Notifications settings screen wraps setLevels(true) in try/catch, shows an alert and
    // flips the switch back off if it throws. If setLevels swallows the error instead, the switch
    // stays ON while the server never enabled notifications ("turns off after turning on",
    // and no notifications ever arrive).
    let error: unknown;
    try {
      await setLevels(true);
    } catch (e) {
      error = e;
    }

    assert.ok(mockFetch.mock.calls.length > 0, 'setLevels should have contacted the server');
    assert.ok(error, 'setLevels(true) must surface the server failure to the caller instead of silently succeeding');
    assert.strictEqual(mockStorage[NOTIFICATIONS_NO_AND_DONT_ASK_FLAG], undefined);
  });
});
