/**
 * PriorityScheduler — Passive Invalidation Scheduler
 *
 * A passive queue that schedules cheap dirty-marking callbacks.
 * The RenderLoop calls processFrame(budgetMs) at the start of each frame.
 *
 * CRITICAL: This does NOT own a rAF loop. It is purely a task queue.
 *
 * Tasks here are microsecond operations (e.g., "mark cells layer dirty for region X").
 * Heavy rendering work happens in the render loop, not via scheduler tasks.
 *
 * @module @mog/canvas-engine/scheduler
 */

import { RenderPriority } from '../core/types';

// =============================================================================
// Types
// =============================================================================

export interface SchedulerTask {
  readonly id: string;
  readonly priority: RenderPriority;
  readonly layerId: string;
  readonly hintKey: string;
  execute: () => void;
  cancelled: boolean;
}

export interface SchedulerTaskConfig {
  priority: RenderPriority;
  layerId: string;
  hintKey?: string;
  execute: () => void;
}

export interface SchedulerStats {
  queueDepths: Record<RenderPriority, number>;
  totalProcessed: number;
  averageFrameTime: number;
  maxFrameTime: number;
  fps: number;
  deduplicatedCount: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Per-priority frame budget caps (milliseconds) */
const PRIORITY_BUDGETS: Record<RenderPriority, number> = {
  [RenderPriority.CRITICAL]: Infinity,
  [RenderPriority.USER_BLOCKING]: 8,
  [RenderPriority.NORMAL]: 4,
  [RenderPriority.LOW]: 2,
  [RenderPriority.IDLE]: 1,
};

/** Total frame budget (hard ceiling) */
const TOTAL_FRAME_BUDGET = 12;

/** Dynamic shedding: trigger when rolling avg exceeds this */
const SHEDDING_TRIGGER_MS = 12;

/** Dynamic shedding: recover after N consecutive frames below threshold */
const SHEDDING_RECOVERY_FRAMES = 30;

/** Dynamic shedding: recovery threshold */
const SHEDDING_RECOVERY_MS = 10;

/** Rolling average window size */
const ROLLING_WINDOW = 10;

const FPS_SAMPLE_SIZE = 60;

// =============================================================================
// Implementation
// =============================================================================

export class PriorityScheduler {
  /** Per-priority queues using deduplication key → task */
  private queues: Map<RenderPriority, Map<string, SchedulerTask>> = new Map();

  private nextId = 0;
  private paused = false;

  // Stats
  private frameTimes: number[] = [];
  private totalProcessed = 0;
  private deduplicatedCount = 0;

  // Dynamic shedding
  private sheddingActive = false;
  private consecutiveGoodFrames = 0;

  constructor() {
    // Initialize per-priority queues
    this.queues.set(RenderPriority.CRITICAL, new Map());
    this.queues.set(RenderPriority.USER_BLOCKING, new Map());
    this.queues.set(RenderPriority.NORMAL, new Map());
    this.queues.set(RenderPriority.LOW, new Map());
    this.queues.set(RenderPriority.IDLE, new Map());
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Schedule a task for execution during the next processFrame() call.
   * Deduplicates by layerId + hintKey within the same priority.
   */
  schedule(config: SchedulerTaskConfig): string {
    const id = `sched_${this.nextId++}`;
    const dedupeKey = `${config.layerId}:${config.hintKey ?? 'all'}`;

    const task: SchedulerTask = {
      id,
      priority: config.priority,
      layerId: config.layerId,
      hintKey: dedupeKey,
      execute: config.execute,
      cancelled: false,
    };

    const queue = this.queues.get(config.priority)!;
    if (queue.has(dedupeKey)) {
      this.deduplicatedCount++;
    }
    queue.set(dedupeKey, task);

    return id;
  }

  /** Cancel a specific task by ID */
  cancel(taskId: string): void {
    for (const queue of this.queues.values()) {
      for (const [key, task] of queue) {
        if (task.id === taskId) {
          task.cancelled = true;
          queue.delete(key);
          return;
        }
      }
    }
  }

  /** Cancel all tasks */
  cancelAll(): void {
    for (const queue of this.queues.values()) {
      for (const task of queue.values()) {
        task.cancelled = true;
      }
      queue.clear();
    }
  }

  /** Execute all pending tasks synchronously, ignoring budgets */
  flush(): void {
    for (const priority of SORTED_PRIORITIES) {
      const queue = this.queues.get(priority)!;
      for (const task of queue.values()) {
        this.executeTask(task);
      }
      queue.clear();
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  dispose(): void {
    this.cancelAll();
  }

  /**
   * Process tasks within the given budget. Called by the RenderLoop
   * at the start of each frame.
   *
   * Returns the time spent processing tasks (ms).
   */
  processFrame(budgetMs: number = TOTAL_FRAME_BUDGET): number {
    if (this.paused) return 0;

    const frameStart = performance.now();
    let totalTimeSpent = 0;

    for (const priority of SORTED_PRIORITIES) {
      // Dynamic shedding: skip LOW tasks when shedding is active
      if (this.sheddingActive && priority === RenderPriority.LOW) continue;

      // IDLE tasks are only processed if budget remains
      if (priority === RenderPriority.IDLE && totalTimeSpent >= budgetMs) continue;

      const queue = this.queues.get(priority)!;
      if (queue.size === 0) continue;

      const priorityBudget = PRIORITY_BUDGETS[priority];
      let priorityTimeSpent = 0;

      // Process tasks at this priority
      // Use Array.from to avoid iterator invalidation during deletion
      const entries = Array.from(queue.entries());
      for (const [key, task] of entries) {
        // Check total frame budget (CRITICAL bypasses this)
        if (priority !== RenderPriority.CRITICAL && totalTimeSpent >= budgetMs) break;

        // Check per-priority budget (CRITICAL has Infinity)
        if (priorityTimeSpent >= priorityBudget) break;

        const taskStart = performance.now();
        this.executeTask(task);
        const taskTime = performance.now() - taskStart;

        totalTimeSpent += taskTime;
        priorityTimeSpent += taskTime;

        queue.delete(key);
      }

      // If total budget exhausted, stop
      if (totalTimeSpent >= budgetMs) break;
    }

    const frameTime = performance.now() - frameStart;
    this.updateFrameStats(frameTime);
    this.updateShedding(frameTime);

    return totalTimeSpent;
  }

  /** Check if there are any pending tasks (excluding IDLE) */
  hasWork(): boolean {
    for (const [priority, queue] of this.queues) {
      if (priority !== RenderPriority.IDLE && queue.size > 0) return true;
    }
    return false;
  }

  /** Check if there are any pending tasks (including IDLE) */
  hasAnyWork(): boolean {
    for (const queue of this.queues.values()) {
      if (queue.size > 0) return true;
    }
    return false;
  }

  getStats(): SchedulerStats {
    const queueDepths = {} as Record<RenderPriority, number>;
    for (const [priority, queue] of this.queues) {
      queueDepths[priority] = queue.size;
    }

    const avgFrameTime =
      this.frameTimes.length > 0
        ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
        : 0;

    const maxFrameTime = this.frameTimes.length > 0 ? Math.max(...this.frameTimes) : 0;

    const fps = avgFrameTime > 0 ? Math.min(60, Math.round(1000 / Math.max(16, avgFrameTime))) : 60;

    return {
      queueDepths,
      totalProcessed: this.totalProcessed,
      averageFrameTime: avgFrameTime,
      maxFrameTime,
      fps,
      deduplicatedCount: this.deduplicatedCount,
    };
  }

  isSheddingActive(): boolean {
    return this.sheddingActive;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private executeTask(task: SchedulerTask): void {
    if (task.cancelled) return;
    try {
      task.execute();
      this.totalProcessed++;
    } catch (error) {
      console.error(`[PriorityScheduler] Task ${task.id} failed:`, error);
    }
  }

  private updateFrameStats(frameTime: number): void {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > FPS_SAMPLE_SIZE) {
      this.frameTimes.shift();
    }
  }

  private updateShedding(frameTime: number): void {
    // Compute rolling average over last ROLLING_WINDOW frames
    const recentFrames = this.frameTimes.slice(-ROLLING_WINDOW);
    if (recentFrames.length < ROLLING_WINDOW) return;

    const rollingAvg = recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length;

    if (!this.sheddingActive) {
      // Trigger shedding when rolling avg exceeds threshold
      if (rollingAvg > SHEDDING_TRIGGER_MS) {
        this.sheddingActive = true;
        this.consecutiveGoodFrames = 0;
      }
    } else {
      // Track recovery
      if (frameTime < SHEDDING_RECOVERY_MS) {
        this.consecutiveGoodFrames++;
        if (this.consecutiveGoodFrames >= SHEDDING_RECOVERY_FRAMES) {
          this.sheddingActive = false;
          this.consecutiveGoodFrames = 0;
        }
      } else {
        this.consecutiveGoodFrames = 0;
      }
    }
  }
}

// Pre-sorted priorities (CRITICAL first)
const SORTED_PRIORITIES: RenderPriority[] = [
  RenderPriority.CRITICAL,
  RenderPriority.USER_BLOCKING,
  RenderPriority.NORMAL,
  RenderPriority.LOW,
  RenderPriority.IDLE,
];
