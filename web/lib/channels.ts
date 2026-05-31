// Fixed channel group ids — mirror of api/app/studio/groups.py. These never
// change (DB names can). Used to label whether a placement is a move (the raw
// leaves «Реальные») or a copy (the source stays). The backend is the source of
// truth for the actual operation; this only drives the UI wording.
export const CHANNELS = {
  reference: "ae697d8d-e803-42c4-9982-ecefbf8a8cdf", // Эталонные на публикацию
  publication: "3cf67240-7597-451a-8ec1-fb097afdeb88", // На публикацию
  real: "721bf726-cdda-4ca8-bf22-f345ca0f677b", // Реальные фотографии
  library: "0a7fbbdf-e605-48f1-a320-ca2094a0f32c", // Свободные коллажи
} as const;

/** A move (source emptied) happens only for Реальные → На публикацию — the
 * single `DIRECT_MOVE_TARGETS` route. Everything else is a copy. */
export function isMove(sourceGroupId: string, targetGroupId: string): boolean {
  return sourceGroupId === CHANNELS.real && targetGroupId === CHANNELS.publication;
}
