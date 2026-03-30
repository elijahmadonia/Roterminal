import { DEFAULT_TRACKED_IDS } from '../config.mjs'

export async function migrateLegacyJsonIfNeeded(database) {
  const { countTrackedUniverseIds, replaceTrackedUniverseIds } = database

  if (await countTrackedUniverseIds() === 0) {
    await replaceTrackedUniverseIds(DEFAULT_TRACKED_IDS)
  }
}
