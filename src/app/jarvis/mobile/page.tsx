import MobileCommander from "./MobileCommander.tsx";
import "./mobile.css";
import "./voice-entry.css";

export const dynamic = "force-dynamic";

export default function JarvisMobilePage() {
  return (
    <>
      <div className="commander-voice-launch"><a href="/jarvis/mobile/voice">🎙 音声司令</a></div>
      <MobileCommander />
    </>
  );
}
