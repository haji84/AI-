import type { SVGProps } from "react";
const paths = {
  home: ["m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"],
  devices: ["M8 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M10 17h6M3 7v10"],
  tasks: ["M9 5h11M9 12h11M9 19h11", "m3 5 1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2"],
  research: ["M10 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m15 15 6 6M7 11l2-3 3 4 2-2"],
  settings: ["M4 7h16M4 17h16M8 4v6m8 4v6"],
  send: ["m4 4 17 8-17 8 3-8-3-8Z", "M7 12h14"],
  arrow: ["M4 12h16m-6-6 6 6-6 6"],
  plus: ["M12 5v14M5 12h14"],
  shield: ["m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z", "m8 12 3 3 5-6"],
  palette: ["M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3 8 8 0 0 0-9-7Z", "M7 9h.01M11 6h.01M16 8h.01M6 14h.01"],
  grid: ["M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z"],
  record: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  recovery: ["M3 11a9 9 0 1 1 2 7M3 4v7h7", "M12 7v5l3 2"],
  learn: ["m2 8 10-5 10 5-10 5-10-5Zm4 3v6l6 3 6-3v-6M22 8v8"],
} as const;
export type GoriqIconName = keyof typeof paths;
export default function GoriqIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: GoriqIconName }) {
  return <svg {...props} className={`goriq-icon ${props.className ?? ""}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name].map((d,i)=><path key={i} d={d} />)}</svg>;
}
