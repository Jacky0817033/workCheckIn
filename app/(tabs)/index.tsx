import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Link } from 'expo-router'; // 引入跳轉功能
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>我的上班小工具</Text>

      <View style={styles.grid}>
        {/* 使用 Link 元件來跳轉 */}
        <Link href="/LabelPrinter" asChild>
          <TouchableOpacity style={styles.card}>
            <Ionicons name="barcode" size={40} color="#5856D6" />
            <Text style={styles.cardText}>商品卡列印</Text>
          </TouchableOpacity>
        </Link>

        {/* 這裡可以預留其他功能的按鈕 */}
        <TouchableOpacity style={[styles.card, { opacity: 0.5 }]}>
          <Ionicons name="location" size={40} color="#007AFF" />
          <Text style={styles.cardText}>打卡系統(開發中)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7', padding: 20, justifyContent: 'center' },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 30, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  card: {
    backgroundColor: '#fff',
    width: '40%',
    aspectRatio: 1,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
  },
  cardText: { marginTop: 10, fontSize: 16, fontWeight: '500' },
});