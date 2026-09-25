"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, SlidersHorizontal } from "lucide-react";
import styles from "@/app/landing.module.css";

const shortMonths = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN"];
const longMonths = ["JUL", "AUG", "SEP", "OCT", "NOV", "DEC", ...shortMonths];
const sales = {
  six: [92, 126, 113, 157, 181, 214],
  year: [65, 83, 72, 96, 88, 113, 92, 126, 113, 157, 181, 214],
};

export function LandingHero() {
  const heroRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameId = useRef<number | null>(null);
  const [range, setRange] = useState<"six" | "year">("six");
  const [northOnly, setNorthOnly] = useState(false);
  const [activeBar, setActiveBar] = useState<number | null>(null);
  const months = range === "six" ? shortMonths : longMonths;
  const values = sales[range].map((value) => Math.round(value * (northOnly ? 0.41 : 1)));
  const selectedBar = activeBar === null ? values.length - 1 : activeBar;

  const movePointer = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (frameId.current !== null) cancelAnimationFrame(frameId.current);
    const x = event.clientX;
    const y = event.clientY;
    frameId.current = requestAnimationFrame(() => {
      const hero = heroRef.current;
      const frame = frameRef.current;
      if (!hero || !frame) return;
      const heroBounds = hero.getBoundingClientRect();
      hero.style.setProperty("--pointer-x", `${x - heroBounds.left}px`);
      hero.style.setProperty("--pointer-y", `${y - heroBounds.top}px`);
      const bounds = frame.getBoundingClientRect();
      const centerX = (x - bounds.left) / bounds.width - 0.5;
      const centerY = (y - bounds.top) / bounds.height - 0.5;
      frame.style.setProperty("--tilt-x", `${Math.max(-1, Math.min(1, centerX * 2))}deg`);
      frame.style.setProperty("--tilt-y", `${Math.max(-1, Math.min(1, centerY * -2))}deg`);
    });
  };
  const resetPointer = () => {
    if (frameId.current !== null) cancelAnimationFrame(frameId.current);
    frameId.current = null;
    frameRef.current?.style.setProperty("--tilt-x", "0deg");
    frameRef.current?.style.setProperty("--tilt-y", "0deg");
    heroRef.current?.style.setProperty("--pointer-x", "-1000px");
  };

  return (
    <section className={styles.hero} ref={heroRef} onPointerMove={movePointer} onPointerLeave={resetPointer}>
      <div className={styles.dotField} aria-hidden="true" />
      <svg className={styles.circuitLines} viewBox="0 0 1400 860" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 82h150l94 94v112l125 125M1400 78h-134l-82 82v120l-116 116M0 345h109l76 76v87l104 104M1400 311h-126l-82 82v132l-110 110" />
        <circle cx="150" cy="82" r="6" /><circle cx="244" cy="176" r="5" /><circle cx="1266" cy="78" r="6" /><circle cx="1184" cy="160" r="5" />
        <circle cx="185" cy="421" r="5" /><circle cx="1192" cy="393" r="5" />
      </svg>
      <div className={styles.heroContent}>
        <span className={styles.heroEyebrow}><span /> A clearer view of your data</span>
        <h1>Turn your data into a<br className={styles.desktopBreak} /> <em>dashboard</em> you can trust.</h1>
        <p>Bring in a file, describe what you want to understand, and get an editable dashboard built around your data.</p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryCta} href="/app">Create a dashboard <ArrowUpRight size={17} /></Link>
          <a className={styles.secondaryCta} href="#how-it-works">See how it works <ArrowRight size={17} /></a>
        </div>
      </div>

      <div className={styles.dashboardStage}>
        <div className={styles.dashboardFrame} ref={frameRef}>
          <div className={styles.dashboardToolbar}>
            <div className={styles.windowDots} aria-hidden="true"><i /><i /><i /></div>
            <span className={styles.previewBreadcrumb}>Sample workspace <span>/</span> Sales overview</span>
            <span className={styles.previewSample}>Illustrative sample data</span>
          </div>
          <div className={styles.dashboardInside}>
            <div className={styles.previewHeading}>
              <div><span className={styles.previewOverline}>OVERVIEW</span><h2>Sales at a glance</h2><p>See the patterns behind your performance.</p></div>
              <div className={styles.previewControls}>
                <button type="button" onClick={() => { setNorthOnly((current) => !current); setActiveBar(null); }} aria-pressed={northOnly}>
                  <SlidersHorizontal size={13} /> {northOnly ? "North region" : "All regions"} <ChevronDown size={13} />
                </button>
                <button type="button" onClick={() => { setRange((current) => current === "six" ? "year" : "six"); setActiveBar(null); }} aria-label={`Showing ${range === "six" ? "last six months" : "last twelve months"}. Switch range.`}>
                  {range === "six" ? "Last 6 months" : "Last 12 months"} <ChevronDown size={13} />
                </button>
              </div>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metricCard}><span>Total revenue</span><strong>{range === "six" ? northOnly ? "$472,700" : "$1,175,914" : northOnly ? "$852,320" : "$2,104,820"}</strong><small><b>↗</b> Revenue from sample orders</small></div>
              <div className={styles.metricCard}><span>Total profit</span><strong>{range === "six" ? northOnly ? "$191,400" : "$476,244" : northOnly ? "$343,200" : "$845,600"}</strong><small><b>↗</b> Calculated from sample data</small></div>
              <div className={styles.metricCard}><span>Orders</span><strong>{range === "six" ? northOnly ? "810" : "2,014" : northOnly ? "1,405" : "3,492"}</strong><small>Across selected period</small></div>
            </div>
            <div className={styles.chartsGrid}>
              <div className={styles.revenuePanel}>
                <div className={styles.panelTitle}><div><h3>Revenue over time</h3><p>Monthly revenue · USD</p></div><span className={styles.panelLegend}><i /> Revenue</span></div>
                <div className={styles.chartArea} role="group" aria-label="Illustrative monthly revenue chart">
                  <div className={styles.chartGrid} aria-hidden="true"><span>$250k</span><span>$175k</span><span>$100k</span><span>$25k</span></div>
                  <div className={styles.barRow}>
                    {values.map((value, index) => (
                      <button key={`${range}-${index}`} type="button" className={`${styles.barButton} ${selectedBar === index ? styles.barActive : ""}`} style={{ height: `${Math.max(15, (value / 250) * 100)}%` }} aria-label={`${months[index]}: ${value} thousand dollars sample revenue`} onMouseEnter={() => setActiveBar(index)} onFocus={() => setActiveBar(index)} onMouseLeave={() => setActiveBar(null)} onBlur={() => setActiveBar(null)}>
                        <span className={styles.barTip}>{months[index]} · ${value}k</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.monthLabels} aria-hidden="true">{months.map((month, index) => <span key={`${month}-${index}`}>{month}</span>)}</div>
              </div>
              <div className={styles.regionPanel}>
                <div className={styles.panelTitle}><div><h3>Revenue by region</h3><p>Share of total revenue</p></div></div>
                <div className={styles.donutWrap}>
                  <div className={styles.donut} style={{ background: northOnly ? "conic-gradient(#4b896a 0 100%)" : "conic-gradient(#4b896a 0 41%, #83a6b6 41% 72%, #d8aa71 72% 89%, #d9ded7 89% 100%)" }}>
                    <div><span>{northOnly ? "North" : "Total"}</span><strong>{northOnly ? "41%" : "100%"}</strong></div>
                  </div>
                  <div className={styles.regionLegend}><span><i className={styles.legendNorth} /> North</span><span><i className={styles.legendWest} /> West</span><span><i className={styles.legendSouth} /> South</span></div>
                </div>
              </div>
            </div>
            <div className={styles.previewBottom}><span><i /> Dashboard saved</span><span>Move, filter, and refine your view <ArrowRight size={13} /></span></div>
          </div>
        </div>
        <span className={styles.floatingNote}>An answer you can explore <ArrowUpRight size={14} /></span>
      </div>
    </section>
  );
}
