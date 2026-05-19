export const REAL_PHOTOS_GROUP_ID = "721bf726-cdda-4ca8-bf22-f345ca0f677b";
export const DEFECT_PHOTOS_GROUP_ID = "edce2987-daae-4339-8330-8cb96ad912bf";

const DRAFT_GROUP_IDS = new Set([REAL_PHOTOS_GROUP_ID, DEFECT_PHOTOS_GROUP_ID]);

export function isDraftGroup(groupId: string): boolean {
  return DRAFT_GROUP_IDS.has(groupId);
}
