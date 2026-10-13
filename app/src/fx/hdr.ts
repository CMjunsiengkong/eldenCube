/**
 * 1.6 V1 selective bloom: fire, beam and ember colors are multiplied by this factor so they exceed
 * the bloom threshold in the linear HDR image (nothing else does). 1 with ?lowfx (no post-processing).
 */
import { CONFIG } from '../config';
import { getFlags } from '../flags';

export const fireBoost = (): number => (getFlags().lowfx ? 1 : CONFIG.vfx.bloom.fireBoost);

/**
 * White flashes and glows that must NOT bloom (boss hit flash, crown tell glow, player heal flash)
 * are scaled by this so the lit surface stays under the threshold. 1 with ?lowfx.
 */
export const noGlow = (): number => (getFlags().lowfx ? 1 : CONFIG.vfx.bloom.noGlowEmissive);

/** The Flame Beam's layers (already very bright when stacked) and the molten scar use smaller boosts. */
export const beamBoost = (): number => (getFlags().lowfx ? 1 : CONFIG.vfx.bloom.beamBoost);
export const moltenBoost = (): number => (getFlags().lowfx ? 1 : CONFIG.vfx.bloom.moltenBoost);
