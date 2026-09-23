"use client";
import type { CSSProperties } from "react";
import { usePersonalUi } from "./PersonalizationProvider";
import { findVisualConcept, visualConceptStyle, type VisualConcept } from "./visual-concepts";

/** SVG viewBox crops the local atlas without stretching portraits or adjacent tiles. */
export function ConceptArtwork({ concept, className = "" }: { concept: VisualConcept; className?: string }) {
  const width = concept.grid.rows === 1 ? 1774 : 1536;
  const height = concept.grid.rows === 1 ? 887 : 1024;
  const cellWidth = width / 2, cellHeight = height / concept.grid.rows;
  const insetX = cellWidth * .025, insetY = cellHeight * .065;
  const box = `${concept.grid.column * cellWidth + insetX} ${concept.grid.row * cellHeight + insetY} ${cellWidth - 2 * insetX} ${cellHeight - 2 * insetY}`;
  return <svg className={`personal-artwork ${className}`} viewBox={box} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <image href={concept.atlas} width={width} height={height} />
  </svg>;
}
export default function PersonalHero() {
  const { profile, legacy } = usePersonalUi();
  const concept = findVisualConcept(profile.conceptId);
  if (!concept || legacy) return null;
  return <section className="personal-hero" style={visualConceptStyle(concept) as CSSProperties} aria-label="選択中のデザイン">
    <ConceptArtwork concept={concept} />
    <div className="personal-hero-shade" />
    <div className="personal-hero-copy"><p>YOUR PERSONAL GORIQ</p><h1>おかえりなさい。</h1><span>{profile.name} · {concept.label}</span><a href="/jarvis/settings#appearance" className="button">デザインを選ぶ</a></div>
  </section>;
}
