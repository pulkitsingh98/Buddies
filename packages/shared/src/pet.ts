import type { PetKind, PetStyle } from './constants';

/**
 * The rendering contract for a pet, shared by every generator style and (Phase 3) by friends'
 * apps that render a visiting pet. Stored locally as `manifest.json` next to `sprite.png`.
 */
export interface PetManifest {
  version: 1;
  id: string;
  name: string;
  kind: PetKind;
  style: PetStyle;
  createdAt: string;
  /** Required true for `kind: 'person'`: "I have this person's permission." */
  consentConfirmed: boolean;
  sprite: {
    file: 'sprite.png';
    width: number;
    height: number;
    /** Present for sprite-sheet styles (Phase 5); absent = a single procedurally animated cutout. */
    frames?: Record<string, { x: number; y: number; w: number; h: number }[]>;
  };
  render: {
    /** Base "chibi" squash: scaleY multiplier (< 1 = squatter); scaleX is its inverse square root. */
    squash: number;
  };
  /** Normalised eye positions for a blink overlay, when they could be located. */
  eyes?: { x: number; y: number; r: number }[];
}
