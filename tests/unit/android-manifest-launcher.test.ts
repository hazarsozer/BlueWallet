import fs from 'fs';
import path from 'path';

const manifestPath = path.join(__dirname, '../../android/app/src/main/AndroidManifest.xml');

type Entry = { tag: string; name: string; actions: string[] };

// Minimal parser: finds every <activity>/<activity-alias> and the actions of its intent-filters.
const parseActivities = (xml: string): Entry[] => {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  const entries: Entry[] = [];
  const re = /<(activity-alias|activity)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments))) {
    const name = /android:name="([^"]+)"/.exec(m[2])?.[1] ?? '';
    const body = m[4] ?? '';
    const actions: string[] = [];
    const filterRe = /<intent-filter\b[\s\S]*?<\/intent-filter>/g;
    let f: RegExpExecArray | null;
    while ((f = filterRe.exec(body))) {
      const actionRe = /<action\s+android:name="([^"]+)"/g;
      let a: RegExpExecArray | null;
      while ((a = actionRe.exec(f[0]))) actions.push(a[1]);
    }
    entries.push({ tag: m[1], name, actions });
  }
  return entries;
};

describe('Android manifest launcher entries', () => {
  const activities = parseActivities(fs.readFileSync(manifestPath, 'utf8'));

  it('declares the main activity as an app entry point', () => {
    const main = activities.find(a => a.name === '.MainActivity');
    expect(main).toBeDefined();
    expect(main!.actions).toContain('android.intent.action.MAIN');
  });

  // Users see a second BlueWallet icon (deleting one removes both) because a secondary activity
  // (SettingsActivity) declares its own MAIN entry point. Only MainActivity may be an app entry point;
  // the settings screen must be reached via APPLICATION_PREFERENCES only.
  it('does not expose any activity other than MainActivity as a MAIN entry point', () => {
    const extraEntryPoints = activities.filter(a => a.name !== '.MainActivity' && a.actions.includes('android.intent.action.MAIN')).map(a => a.name);
    expect(extraEntryPoints).toEqual([]);
  });
});
