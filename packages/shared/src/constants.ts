export const APP_NAME = 'DeskPals';

export const PET_KINDS = ['person', 'animal', 'object'] as const;
export type PetKind = (typeof PET_KINDS)[number];

export const PET_STYLES = ['cutout', 'stylized'] as const;
export type PetStyle = (typeof PET_STYLES)[number];

/** Max length of a quick message, enforced client-side and in the DB. */
export const MESSAGE_MAX_LEN = 200;

/** Realtime channel names. Each client subscribes only to its own user channel. */
export const userChannel = (userId: string) => `user:${userId}`;
