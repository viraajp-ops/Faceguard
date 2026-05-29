import React, { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('App crashed:', error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>FaceGuard stopped unexpectedly</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <Text style={styles.hint}>
            Install the development build on your phone with `npm run android:device`, then open the
            FaceGuard app icon — not Expo Go.
          </Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#101820'
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800'
  },
  message: {
    color: '#d1d9e0',
    fontSize: 15,
    lineHeight: 22
  },
  hint: {
    color: '#9fb0c0',
    fontSize: 14,
    lineHeight: 20
  },
  button: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e'
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16
  }
});
