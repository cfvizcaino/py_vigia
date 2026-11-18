/* global jest */
/**
 * Reanimated under Jest. Version 4.7 resolves its .native modules here, and they need the
 * native worklets runtime, so the official mocks fail. This small mock covers what the app
 * uses: components render as plain views, shared values hold their target value and
 * animations jump to their end. The tests check logic and screens; motion is checked on
 * the phone.
 */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');

  const identity = (value) => value;
  const curve = () => identity;
  const Easing = {
    linear: identity, ease: identity, quad: identity, cubic: identity, sin: identity, circle: identity, exp: identity,
    in: curve, out: curve, inOut: curve, bezier: curve, poly: curve,
  };
  const builder = () => {
    const self = {};
    for (const name of ['duration', 'delay', 'easing', 'withInitialValues', 'reduceMotion', 'springify', 'damping', 'withCallback']) {
      self[name] = () => self;
    }
    return self;
  };
  const makeMutable = (initial) => {
    const mutable = { value: initial };
    mutable.get = () => mutable.value;
    mutable.set = (next) => { mutable.value = typeof next === 'function' ? next(mutable.value) : next; };
    return mutable;
  };
  const createAnimatedComponent = (Component) => {
    const Animated = React.forwardRef(({ entering, exiting, layout, animatedProps, ...props }, ref) =>
      React.createElement(Component, { ...props, ...(animatedProps ?? {}), ref }));
    Animated.displayName = `Animated(${Component.displayName ?? Component.name ?? 'Component'})`;
    return Animated;
  };
  const AnimatedView = createAnimatedComponent(View);
  return {
    __esModule: true,
    default: { View: AnimatedView, createAnimatedComponent },
    createAnimatedComponent,
    Easing,
    FadeIn: builder(), FadeInDown: builder(), FadeInUp: builder(), FadeOut: builder(),
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    cancelAnimation: () => undefined,
    makeMutable,
    runOnJS: (fn) => fn,
    useAnimatedProps: (updater) => updater(),
    useAnimatedStyle: (updater) => updater(),
    useReducedMotion: () => false,
    useSharedValue: (initial) => React.useState(() => makeMutable(initial))[0],
    withRepeat: identity,
    withSequence: (...steps) => steps[steps.length - 1],
    withTiming: identity,
  };
});
