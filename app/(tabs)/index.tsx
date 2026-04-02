import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// 🚀 引入三個主要功能組件
import EmployeeManager from '../../components/EmployeeManager';
import LabelPrinter from '../../components/LabelPrinter';
import PayrollService from '../../components/PayrollService'; // 這是下一個要建立的檔案

export default function HomeScreen() {
  // 狀態切換：'mgmt' (人員), 'payroll' (發薪), 'label' (標籤)
  const [activeTab, setActiveTab] = useState<'mgmt' | 'payroll' | 'label'>('payroll');

  return (
    <SafeAreaView style={styles.container}>
      {/* 頂部切換選單 */}
      <View style={styles.tabBarContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'mgmt' && styles.activeTabBtn]}
          onPress={() => setActiveTab('mgmt')}
        >
          <Text style={[styles.tabText, activeTab === 'mgmt' && styles.activeTabText]}>人員管理</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'payroll' && styles.activeTabBtn]}
          onPress={() => setActiveTab('payroll')}
        >
          <Text style={[styles.tabText, activeTab === 'payroll' && styles.activeTabText]}>薪資發放</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'label' && styles.activeTabBtn]}
          onPress={() => setActiveTab('label')}
        >
          <Text style={[styles.tabText, activeTab === 'label' && styles.activeTabText]}>標籤製作</Text>
        </TouchableOpacity>
      </View>

      {/* 根據狀態顯示對應組件 */}
      <View style={{ flex: 1 }}>
        {activeTab === 'mgmt' && <EmployeeManager />}
        {activeTab === 'payroll' && <PayrollService />}
        {activeTab === 'label' && <LabelPrinter />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7', // iOS 系統背景色
  },
  tabBarContainer: {
    flexDirection: 'row',
    backgroundColor: '#E5E5EA',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  activeTabBtn: {
    backgroundColor: '#FFFFFF',
    // 增加陰影讓選中的按鈕有浮起感
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
  },
  activeTabText: {
    color: '#007AFF', // 選中時的藍色
  },
});