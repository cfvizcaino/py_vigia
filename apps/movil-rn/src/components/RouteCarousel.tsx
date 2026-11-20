import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { Icon } from './Icon';
import { tapFeedback } from './motion';

export const CARD_WIDTH = 196;
const GAP = 14;
const STEP = CARD_WIDTH + GAP;

export interface RouteCard {
  key: string;
  title: string;
  subtitle: string;
  score: number;
}

/**
 * Rutas candidatas que se deslizan a la izquierda o a la derecha. La tarjeta del centro es
 * la ruta enfocada (la que muestra el mapa); las de los lados se achican y atenúan según su
 * distancia, siguiendo el dedo. Tocar una tarjeta la centra y la selecciona: su detalle se
 * despliega debajo. Tocar la seleccionada lo pliega.
 */
export function RouteCarousel({ cards, focused, selected, onFocus, onSelect }: {
  cards: RouteCard[];
  focused: number;
  selected: number | null;
  onFocus: (index: number) => void;
  onSelect: (index: number | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(focused * STEP);
  const onScroll = useAnimatedScrollHandler({ onScroll: (event) => { scrollX.set(event.contentOffset.x); } });
  const side = width ? (width - CARD_WIDTH) / 2 : 0;

  const goTo = useCallback((index: number, animated = true) => {
    scrollRef.current?.scrollTo({ x: index * STEP, animated });
  }, [scrollRef]);

  // A new query (or a route chosen elsewhere) moves the carousel without a swipe.
  useEffect(() => {
    if (width) goTo(focused, false);
    // Only when the layout is known; later focus changes come from the carousel itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(cards.length - 1, Math.round(event.nativeEvent.contentOffset.x / STEP)));
    if (index !== focused) {
      tapFeedback('selection');
      onFocus(index);
    }
  };

  return (
    <View>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.viewport}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={STEP}
          disableIntervalMomentum
          contentContainerStyle={{ paddingHorizontal: side, gap: GAP, alignItems: 'center' }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={settle}
          accessibilityLabel="Rutas candidatas. Desliza para cambiar de ruta."
        >
          {cards.map((card, index) => (
            <Card
              key={card.key}
              card={card}
              index={index}
              scrollX={scrollX}
              isSelected={selected === index}
              onPress={() => {
                if (index !== focused) {
                  goTo(index);
                  onFocus(index);
                  onSelect(index);
                } else {
                  onSelect(selected === index ? null : index);
                }
                tapFeedback();
              }}
            />
          ))}
        </Animated.ScrollView>
      </View>
      <View style={styles.dots}>
        {cards.map((card, dot) => (
          <Pressable key={card.key} accessibilityRole="button" accessibilityLabel={`Ir a ${card.title}`} hitSlop={8} onPress={() => { goTo(dot); onFocus(dot); }}>
            <View style={dot === focused ? styles.dotOn : styles.dot} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Card({ card, index, scrollX, isSelected, onPress }: {
  card: RouteCard; index: number; scrollX: SharedValue<number>; isSelected: boolean; onPress: () => void;
}) {
  const style = useAnimatedStyle(() => {
    const distance = Math.abs(scrollX.get() - index * STEP) / STEP;
    return {
      opacity: interpolate(distance, [0, 1], [1, 0.5], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(distance, [0, 1], [1, 0.84], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${card.title}, ${card.subtitle}, ${card.score} de 100`}
        accessibilityState={{ selected: isSelected }}
        accessibilityHint={isSelected ? 'Toca para ocultar el detalle' : 'Toca para ver el detalle'}
        onPress={onPress}
      >
        <LinearGradient colors={gradients.routeCard} locations={[0, 0.92]} style={[styles.card, isSelected && styles.cardOn]}>
          <Icon name="routePin" size={28} />
          <Text style={[type(fonts.poppins, 17.5, 21, 0), styles.center]}>{card.title}</Text>
          <Text style={[type(fonts.light, 10.5, 12.6), styles.center]}>{card.subtitle}</Text>
          <Text style={[type(fonts.light, 10, 12), styles.center, { marginTop: 4 }]}>
            <Text style={{ fontFamily: fonts.medium }}>{card.score}</Text>/100
          </Text>
          <View style={[styles.cta, isSelected && styles.ctaOn]}>
            <Text style={type(fonts.medium, 10, 12, 0)}>{isSelected ? 'Ocultar detalle' : 'Ver detalle'}</Text>
            <View style={isSelected ? styles.flip : null}><Icon name="ms_keyboard_arrow_down" size={14} color="#ffffff" /></View>
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: { height: 236, marginTop: 12, marginHorizontal: -16 },
  card: { width: CARD_WIDTH, height: 221, borderRadius: 19, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, gap: 4, borderWidth: 1.5, borderColor: 'transparent', elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 4 } },
  cardOn: { borderColor: 'rgba(255,255,255,0.85)' },
  center: { textAlign: 'center' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)' },
  flip: { transform: [{ rotate: '180deg' }] },
  ctaOn: { backgroundColor: 'rgba(157,118,248,0.55)' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(217,217,217,0.2)' },
  dotOn: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#ffffff' },
});
