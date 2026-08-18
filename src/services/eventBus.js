const { EventEmitter } = require('events');

/**
 * In-process pub/sub used to push analytics refreshes to SSE clients the moment
 * a submission is graded, instead of making dashboards poll.
 *
 * A single-node emitter is enough here; swapping it for Redis pub/sub would be
 * the only change needed to run several API instances behind a load balancer.
 */
class ExamEventBus extends EventEmitter {
  gradedBatch(examId, payload) {
    this.emit(`exam:${examId}`, { type: 'grading.updated', ...payload });
  }

  submitted(examId, payload) {
    this.emit(`exam:${examId}`, { type: 'submission.created', ...payload });
  }

  published(examId, payload) {
    this.emit(`exam:${examId}`, { type: 'results.published', ...payload });
  }

  subscribe(examId, listener) {
    const channel = `exam:${examId}`;
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }
}

const bus = new ExamEventBus();
bus.setMaxListeners(0);

module.exports = bus;
