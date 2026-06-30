const vibrate = pattern => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};

export const haptics = {
  tap:   () => vibrate(10),
  snap:  () => vibrate([30, 10, 30]),
  storm: () => vibrate(50),
  win:   () => vibrate([100, 50, 100, 50, 200]),
};
