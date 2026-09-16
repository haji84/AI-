import MobileVoiceCommander from "./MobileVoiceCommander";
import SpeechPersonaStylePanel from "./SpeechPersonaStylePanel";
import "../mobile.css";
import "./voice.css";

export const dynamic = "force-dynamic";

export default function JarvisMobileVoicePage() {
  return (
    <>
      <SpeechPersonaStylePanel />
      <MobileVoiceCommander />
    </>
  );
}
