/**
 * OracleLoadingOverlay — routes to Classic cyber or League broadcast overlay.
 */

import { useHexaTheme } from '../themeProvider';
import { useSport } from '../context/SportContext.jsx';
import OracleLoadingOverlayClassic from './OracleLoadingOverlayClassic.jsx';
import OracleLoadingOverlayLeague from './OracleLoadingOverlayLeague.jsx';

export default function OracleLoadingOverlay({ lang = 'en' }) {
  const { isLeague } = useHexaTheme();
  const { sport } = useSport();

  if (isLeague) {
    return <OracleLoadingOverlayLeague lang={lang} sport={sport} />;
  }
  return <OracleLoadingOverlayClassic lang={lang} />;
}
