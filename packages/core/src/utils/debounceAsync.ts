export function debounceAsync(callback: () => Promise<any>, ms: number) {
  let timeout: NodeJS.Timeout | undefined;
  let promise: Promise<any> | undefined;
  let rerun = false;
  let enabled = false;
  const fn = async () => {
    promise = callback();
    try {
      await promise;
    } finally {
      promise = undefined;
    }
    if (enabled && rerun) {
      rerun = false;
      fn();
    }
  };
  return {
    call: () => {
      if (!enabled) return;

      if (promise) {
        rerun = true;
      } else {
        clearTimeout(timeout);
        timeout = setTimeout(fn, ms);
      }
    },

    disable: async () => {
      enabled = false;
      clearTimeout(timeout);
      await promise;
    },

    enable: () => {
      enabled = true;
    },
  };
}
