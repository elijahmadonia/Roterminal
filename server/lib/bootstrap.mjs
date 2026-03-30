import { readFile } from 'node:fs/promises'

import { DATA_BACKEND, DEFAULT_TRACKED_IDS, LEGACY_STATE_PATH } from '../config.mjs'

export async function migrateLegacyJsonIfNeeded(database) {
  const { countTrackedUniverseIds, importLegacySnapshot, replaceTrackedUniverseIds } = database

  if (DATA_BACKEND !== 'sqlite') {
    if (countTrackedUniverseIds() === 0) {
      replaceTrackedUniverseIds(DEFAULT_TRACKED_IDS)
    }
    return
  }

  if (countTrackedUniverseIds() > 0) {
    return
  }

  try {
    const rawLegacy = await readFile(LEGACY_STATE_PATH, 'utf8')
    const legacyState = JSON.parse(rawLegacy)
    const trackedIds =
      Array.isArray(legacyState.trackedUniverseIds) && legacyState.trackedUniverseIds.length > 0
        ? legacyState.trackedUniverseIds
        : DEFAULT_TRACKED_IDS

    replaceTrackedUniverseIds(trackedIds)

    if (legacyState.snapshots && typeof legacyState.snapshots === 'object') {
      for (const [universeId, snapshots] of Object.entries(legacyState.snapshots)) {
        for (const snapshot of snapshots) {
          importLegacySnapshot(Number(universeId), snapshot)
        }
      }
    }
  } catch {
    replaceTrackedUniverseIds(DEFAULT_TRACKED_IDS)
  }
}
