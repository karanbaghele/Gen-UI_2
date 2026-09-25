import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Database,
  FileSpreadsheet,
  GripVertical,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { LandingHero } from "@/components/landing-hero";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "GenUI — Turn your data into a dashboard you can trust",
  description:
    "Upload a CSV or connect a Google Sheet, describe what you want to understand, and build an editable dashboard grounded in your data.",
};

const steps = [
  {
    number: "01",
    icon: FileSpreadsheet,
    title: "Bring your data",
    text: "Start with a CSV or connect a Google Sheet. Preview the fields before adding them to your workspace.",
  },
  {
    number: "02",
    icon: MessageSquareText,
    title: "Ask a real question",
    text: "Describe the view you need in your own words. GenUI uses your selected data and its context to plan the dashboard.",
  },
  {
    number: "03",
    icon: SlidersHorizontal,
    title: "Make it yours",
    text: "Filter results, move cards, and refine the layout. Your dashboard is saved so you can return to it.",
  },
];

function Mark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.siteHeader}>
        <div className={styles.navInner}>
          <Link className={styles.wordmark} href="/" aria-label="GenUI home">
            <Mark />
            <span>GenUI</span>
          </Link>
          <nav className={styles.navLinks} aria-label="Landing page">
            <a href="#how-it-works">How it works</a>
            <a href="#why-genui">Why GenUI</a>
            <a href="#data-sources">Data sources</a>
          </nav>
          <div className={styles.navActions}>
            <Link className={styles.signIn} href="/login">
              Sign in
            </Link>
            <Link className={styles.navCta} href="/app">
              Open GenUI <ArrowUpRight size={15} strokeWidth={1.8} />
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <LandingHero />

        <section className={styles.sourcesRail} aria-label="Ways to begin">
          <p>Start with the data you already have</p>
          <div className={styles.sourceBadges}>
            <span><FileSpreadsheet size={17} /> CSV files</span>
            <span><span className={styles.sheetGlyph} aria-hidden="true">▦</span> Google Sheets</span>
            <span><Database size={17} /> PostgreSQL <small>local app</small></span>
          </div>
        </section>

        <section id="how-it-works" className={styles.howSection}>
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>A clear path from question to view</p>
            <h2>Your data has a story.<br /><span>Start with the question.</span></h2>
            <p>
              You do not need to arrange every chart before you can explore. Start with a source and shape the result as you learn.
            </p>
          </div>
          <div className={styles.steps}>
            {steps.map((step) => (
              <article key={step.number} className={styles.stepCard}>
                <div className={styles.stepTop}>
                  <span>{step.number}</span>
                  <step.icon size={25} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="why-genui" className={styles.detailSection}>
          <div className={styles.detailVisual} aria-hidden="true">
            <div className={styles.detailVisualTop}>
              <span className={styles.visualDot} /> Sales overview
              <span className={styles.visualSaved}>Saved just now</span>
            </div>
            <div className={styles.detailVisualGrid}>
              <div className={styles.visualChart}>
                <span className={styles.visualLabel}>Revenue by month</span>
                <svg viewBox="0 0 360 126" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="landingDetailFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#a2cfb2" stopOpacity=".42" />
                      <stop offset="1" stopColor="#a2cfb2" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 101 L52 82 L104 88 L156 60 L208 67 L260 31 L312 46 L360 13 L360 126 L0 126Z" fill="url(#landingDetailFill)" />
                  <path d="M0 101 L52 82 L104 88 L156 60 L208 67 L260 31 L312 46 L360 13" fill="none" stroke="#3d765d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className={styles.visualKpi}>
                <span className={styles.visualLabel}>Orders</span>
                <strong>2,014</strong>
                <span>Sample sales data</span>
              </div>
            </div>
            <div className={styles.visualHandle}><GripVertical size={15} /> Drag to arrange</div>
          </div>
          <div className={styles.detailCopy}>
            <p className={styles.kicker}>Made to be changed</p>
            <h2>A starting point you can keep shaping.</h2>
            <p>
              Move and resize cards, use linked filters, and ask GenUI to refine a saved dashboard. The numbers come from bounded, deterministic queries over your selected data.
            </p>
            <div className={styles.detailPoints}>
              <span><ChartNoAxesCombined size={18} /> Interactive charts and tables</span>
              <span><GripVertical size={18} /> Editable, saved layouts</span>
              <span><ShieldCheck size={18} /> Data scoped to your workspace</span>
            </div>
            <Link className={styles.textLink} href="/app">
              Open the workspace <ArrowRight size={17} />
            </Link>
          </div>
        </section>

        <section id="data-sources" className={styles.connectSection}>
          <div className={styles.connectPattern} aria-hidden="true" />
          <p className={styles.kicker}>Connect the dots</p>
          <h2>Begin with what you have.</h2>
          <p>
            Upload a CSV or connect a Google Sheet. If you run GenUI locally, you can also connect a read-only PostgreSQL source.
          </p>
          <div className={styles.connectorIcons} aria-hidden="true">
            <span><FileSpreadsheet size={26} strokeWidth={1.6} /></span>
            <span className={styles.connectorCenter}><Mark /></span>
            <span><Database size={26} strokeWidth={1.6} /></span>
          </div>
          <Link className={styles.primaryCta} href="/app">
            Create your first dashboard <ArrowUpRight size={17} />
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link className={styles.wordmark} href="/"><Mark /><span>GenUI</span></Link>
        <p>More room for understanding.</p>
        <Link href="/login">Sign in <ArrowUpRight size={14} /></Link>
      </footer>
    </div>
  );
}
