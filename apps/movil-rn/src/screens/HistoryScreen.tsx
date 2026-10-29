import { Pressable, Text } from 'react-native';

import { Card, DemoBadge, EmptyState, formatDate, Screen } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';

export function HistoryScreen() {
  const { history, isDemo, openResult } = useSession();
  return (
    <Screen>
      {isDemo ? <DemoBadge /> : null}
      {!history.length ? <EmptyState title="Historial vacío" description="Las consultas de esta sesión aparecerán aquí." /> : null}
      {history.map((result) => (
        <Pressable accessibilityRole="button" key={String(result.query.id)} onPress={() => openResult(result)}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{result.routes.length} rutas · {result.candidate_detection_count} detecciones</Text>
            <Text style={{ color: colors.muted }}>{formatDate(result.query.created_at)} · consulta {String(result.query.id)}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
