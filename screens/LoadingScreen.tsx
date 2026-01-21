import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function LoadingScreen({ navigation }: any) {
  const { session, initializing, isParentAccount } = useAuth();
  const [logs, setLogs] = useState<string[]>([]);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);

  const addLog = (msg: string) => {
    const time = ((Date.now() - startTime) / 1000).toFixed(1);
    setLogs(prev => [...prev, `[${time}s] ${msg}`]);
    console.log(`[LoadingScreen] ${msg}`);
  };

  // Update elapsed time every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  // Log initial state
  useEffect(() => {
    addLog(`MOUNTED - initializing=${initializing}, session=${!!session}, isParent=${isParentAccount}`);
  }, []);

  // Log state changes
  useEffect(() => {
    addLog(`STATE: initializing=${initializing}`);
  }, [initializing]);

  useEffect(() => {
    addLog(`STATE: session=${session ? 'YES (user: ' + session.user?.email + ')' : 'NO'}`);
    if (session) {
      const expiresAt = session.expires_at || 0;
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = expiresAt - now;
      addLog(`TOKEN: expires_at=${expiresAt}, now=${now}, expires_in=${expiresIn}s`);
    }
  }, [session]);

  useEffect(() => {
    addLog(`STATE: isParentAccount=${isParentAccount}`);
  }, [isParentAccount]);

  // Navigation logic
  useEffect(() => {
    if (!initializing) {
      addLog(`READY TO NAVIGATE - session=${!!session}, isParent=${isParentAccount}`);

      if (session) {
        const target = isParentAccount ? 'ParentDashboard' : 'Dashboard';
        addLog(`NAVIGATING TO: ${target}`);

        // Small delay so you can see the log
        setTimeout(() => {
          navigation.replace(target);
        }, 500);
      } else {
        addLog('NAVIGATING TO: Login (no session)');
        setTimeout(() => {
          navigation.replace('Login');
        }, 500);
      }
    }
  }, [initializing, session, isParentAccount, navigation]);

  const elapsedSec = (elapsed / 1000).toFixed(1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DEBUG LOADING SCREEN</Text>
      <Text style={styles.timer}>{elapsedSec}s elapsed</Text>

      <View style={styles.statusBox}>
        <Text style={styles.statusLabel}>Auth Status:</Text>
        <Text style={[styles.statusValue, { color: initializing ? '#ff6b6b' : '#51cf66' }]}>
          {initializing ? 'INITIALIZING...' : 'READY'}
        </Text>
      </View>

      <View style={styles.statusBox}>
        <Text style={styles.statusLabel}>Session:</Text>
        <Text style={[styles.statusValue, { color: session ? '#51cf66' : '#ff6b6b' }]}>
          {session ? `YES (${session.user?.email})` : 'NO SESSION'}
        </Text>
      </View>

      <View style={styles.statusBox}>
        <Text style={styles.statusLabel}>Account Type:</Text>
        <Text style={styles.statusValue}>
          {isParentAccount ? 'PARENT' : 'ATHLETE'}
        </Text>
      </View>

      {session && (
        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Token Expires:</Text>
          <Text style={styles.statusValue}>
            {session.expires_at ? `${Math.floor((session.expires_at - Date.now()/1000))}s` : 'UNKNOWN'}
          </Text>
        </View>
      )}

      <Text style={styles.logsTitle}>Event Log:</Text>
      <ScrollView style={styles.logsContainer}>
        {logs.map((log, i) => (
          <Text key={i} style={styles.logLine}>{log}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    color: '#ff6b6b',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  timer: {
    color: '#ffd43b',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  statusBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  statusLabel: {
    color: '#888',
    fontSize: 14,
  },
  statusValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logsTitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 20,
    marginBottom: 8,
  },
  logsContainer: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 10,
  },
  logLine: {
    color: '#4ade80',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
});
