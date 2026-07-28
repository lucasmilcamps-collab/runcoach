import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

/** A 0–4 lightning difficulty gauge (Campus-style), Night-Trail blaze. */
export function DifficultyBolts({ level, total = 4 }: { level: number; total?: number }) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <Svg key={i} width={11} height={15} viewBox="0 0 11 15">
          <Path d="M6 0 0 9h4l-1 6 8-10H6z" fill={i < level ? Colors.blaze : Colors.contourFaint} />
        </Svg>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3, alignItems: 'center' },
});
