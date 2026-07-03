export function createTaskCancellationRegistry() {
  const controllers = new Map();

  return {
    create(taskId) {
      const key = String(taskId);
      controllers.get(key)?.abort();
      const controller = new AbortController();
      controllers.set(key, controller);
      return controller.signal;
    },

    cancel(taskId) {
      const controller = controllers.get(String(taskId));
      if (!controller) {
        return false;
      }
      controller.abort();
      return true;
    },

    release(taskId) {
      controllers.delete(String(taskId));
    },

    has(taskId) {
      return controllers.has(String(taskId));
    },
  };
}
