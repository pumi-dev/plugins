// What awake draws: its page in Settings, and one component that draws nothing at all.
import { OptionRow, Page, Section, openSettings, useEvent, usePlugin } from "pumi";

/** This plugin's prefix (`amresyd.awake.`), from its id. */
function prefixed(): string {
  const id = usePlugin() ?? "";
  return `${id.replace("/", ".").replaceAll("-", "_")}.`;
}

/**
 * The window's end of `Awake settings…`: the click arrives in the worker, which has no window to
 * open Settings in, so it says `open_settings` here. It draws nothing.
 */
export function Bridge() {
  const prefix = prefixed();
  useEvent(`${prefix}open_settings`, () => openSettings(`${prefix}awake`));
  return null;
}

/** Settings → Awake (the manifest's `contributes.settings.pages`). */
export function AwakePage() {
  const prefix = prefixed();
  return (
    <Page title="Awake">
      <Section id={`${prefix}when`}>
        <OptionRow name={`${prefix}working`} />
        <OptionRow name={`${prefix}lid`} />
        <OptionRow name={`${prefix}linger`} />
        <OptionRow name={`${prefix}battery_floor`} />
        <OptionRow name={`${prefix}max_hours`} />
        <OptionRow name={`${prefix}menubar`} />
      </Section>
    </Page>
  );
}
