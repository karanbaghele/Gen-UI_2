import styles from "./bird-loader.module.css";

export function BirdLoading() {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.scene} aria-hidden="true">
        <div className={styles.sky}>
          <div className={styles.bird}>
            {Array.from({ length: 10 }, (_, index) => (
              <div className={styles.wind} key={index} />
            ))}
            <div className={styles.body}>
              <div className={styles.head} />
              <div className={styles.wingLeft}>
                <div className={styles.wingLeftTop} />
              </div>
              <div className={styles.wingRight}>
                <div className={styles.wingRightTop} />
              </div>
              <div className={styles.tailLeft} />
              <div className={styles.tailRight} />
            </div>
          </div>
        </div>
      </div>
      <span className={styles.label}>Loading your workspace…</span>
    </div>
  );
}
