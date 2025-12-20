import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, Image } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
// 改成具名匯出，直接引入方法與列舉
// 指向舊版相容路徑，這樣 readAsStringAsync 就能正常工作
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

interface LabelItem {
    name: string;
    promo: string;
    priceStr: string;
    dateRange: string;
    originalPrice: string;
    imageUri?: string;
}

export default function LabelPrinter() {
    const [mode, setMode] = useState<1 | 8>(8);
    const [items, setItems] = useState<LabelItem[]>([{ name: '', promo: '', priceStr: '', dateRange: '', originalPrice: '', imageUri: '' }]);

    const updateItem = (index: number, field: keyof LabelItem, value: string) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    const pickImage = async (index: number) => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.6,
        });

        if (!result.canceled) {
            try {
                // 現在從 /legacy 引入後，這行就能正常執行，不會跳紅畫面錯誤
                const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
                    encoding: FileSystem.EncodingType.Base64,
                });

                const base64Uri = `data:image/jpeg;base64,${base64}`;
                updateItem(index, 'imageUri', base64Uri);
            } catch (e) {
                console.error("圖片轉換錯誤:", e);
                Alert.alert("錯誤", "無法讀取圖片檔案，請重試");
            }
        }
    };

    const copyPrevious = () => {
        if (items.length >= mode) return;
        const lastItem = { ...items[items.length - 1] };
        setItems([...items, lastItem]);
    };

    const addNew = () => {
        if (items.length >= mode) return;
        setItems([...items, { name: '', promo: '', priceStr: '', dateRange: '', originalPrice: '', imageUri: '' }]);
    };

    const generatePDF = async () => {
        const finalItems = Array.from({ length: mode }, (_, i) => items[i] || { name: '', promo: '', priceStr: '', dateRange: '', originalPrice: '', imageUri: '' });

        let htmlContent = "";

        if (mode === 1) {
            const item = finalItems[0];
            htmlContent = `
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  @page { size: A4; margin: 0; }
                  * { box-sizing: border-box; -webkit-print-color-adjust: exact; font-family: sans-serif; }
                  html, body { margin: 0; padding: 0; width: 210mm; height: 297mm; overflow: hidden; background-color: white; }
                  
                  .page-container {
                    width: 210mm; height: 297mm; padding: 15mm;
                    display: flex; flex-direction: column; 
                    justify-content: space-between; align-items: center;
                  }

                  .top-content {
                    width: 100%;
                    display: flex; flex-direction: column; align-items: center;
                  }

                  .header-row { width: 100%; border-bottom: 2px solid black; padding-bottom: 3mm; margin-bottom: 5mm; }
                  .date-range { font-size: 18pt; color: #333; text-align: left; }
                  
                  .name { font-size: 55pt; font-weight: 900; line-height: 1.1; margin-bottom: 5mm; text-align: center; width: 100%; }
                  
                  .price-area { width: 100%; text-align: center; }
                  .original-price { font-size: 24pt; color: #666; margin-bottom: 3mm; }
                  
                  /* 促銷資訊：無底線，紅色背景白色字 */
                  .promo-badge { 
                    font-size: 56pt; font-weight: bold; color: white; 
                    background-color: red; padding: 4mm 15mm; border-radius: 15mm; 
                    margin-bottom: 5mm; display: inline-block; border: none;
                  }
                  .final-price { font-size: 100pt; font-weight: 900; color: red; line-height: 1; }

                  /* 下方圖片區：置底置中 */
                  .bottom-image-container { 
                    width: 100%; flex: 1;
                    display: flex; justify-content: center; 
                    align-items: flex-end;
                    padding-bottom: 5mm; overflow: hidden;
                  }
                  .product-img { 
                    max-height: 120mm; max-width: 180mm;
                    object-fit: contain; border-radius: 5mm; 
                  }
                </style>
              </head>
              <body>
                <div class="page-container">
                  <div class="top-content">
                      <div class="header-row">
                        <div class="date-range">活動日期：${item.dateRange || '即日起'}</div>
                      </div>
                      <div class="name">${(item.name || '商品名稱').replace(/\n/g, '<br>')}</div>
                      <div class="price-area">
                        <div class="original-price">原價 ${item.originalPrice || '—'} 元</div>
                        ${item.promo ? `<div class="promo-badge">${item.promo}</div>` : ''}
                        <div class="final-price">${item.priceStr || '尚未設定'}</div>
                      </div>
                  </div>

                  <div class="bottom-image-container">
                    ${item.imageUri ? `<img src="${item.imageUri}" class="product-img" />` : ''}
                  </div>
                </div>
              </body>
            </html>`;
        } else {
            // 8格模式 (不帶圖片)
            htmlContent = `
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  @page { size: A4; margin: 0; }
                  * { box-sizing: border-box; -webkit-print-color-adjust: exact; font-family: sans-serif; }
                  html, body { margin: 0; padding: 0; width: 210mm; height: 297mm; overflow: hidden; }
                  .page-container { width: 210mm; height: 297mm; display: flex; flex-wrap: wrap; padding: 4mm; }
                  .card { width: 99mm; height: 69mm; border: 1.5pt solid black; margin: 1mm; display: flex; flex-direction: column; position: relative; overflow: hidden; }
                  .name { height: 28%; font-size: 22pt; font-weight: bold; display: flex; align-items: center; justify-content: center; text-align: center; border-bottom: 2px solid black; padding: 5px; }
                  .promo { height: 25%; font-size: 42pt; font-weight: bold; color: red; display: flex; align-items: center; justify-content: center; border: none; }
                  .price-str { flex: 1; font-size: 52pt; font-weight: 900; color: red; display: flex; align-items: center; justify-content: center; }
                  .date-range { position: absolute; bottom: 5px; right: 10px; font-size: 10pt; color: #333; }
                </style>
              </head>
              <body>
                <div class="page-container">
                  ${finalItems.map(item => `
                    <div class="card">
                      <div class="name">${(item.name || '').replace(/\n/g, '<br>')}</div>
                      <div class="promo">${item.promo || ''}</div>
                      <div class="price-str">${item.priceStr || ''}</div>
                      <div class="date-range">活動日期 : ${item.dateRange || ''}</div>
                    </div>
                  `).join('')}
                </div>
              </body>
            </html>`;
        }

        try {
            const { uri } = await Print.printToFileAsync({ html: htmlContent, width: 595, height: 842 });
            await Sharing.shareAsync(uri);
        } catch (error) {
            Alert.alert('錯誤', 'PDF 生成失敗');
        }
    };

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.container}>
                <Text style={styles.header}>促銷標籤系統</Text>

                <View style={styles.modeSelector}>
                    {[1, 8].map((m) => (
                        <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} onPress={() => setMode(m as any)}>
                            <Text style={mode === m ? styles.modeTextActive : styles.modeText}>{m === 1 ? '大海報' : '8 格模式'}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {(mode === 1 ? [items[0]] : items).map((item, index) => (
                    <View key={index} style={styles.itemCard}>
                        <Text style={styles.itemIndex}>標籤內容 #{index + 1}</Text>

                        <TextInput style={[styles.input, { fontSize: 18, fontWeight: 'bold' }]} placeholder="1. 商品名稱" multiline value={item.name} onChangeText={(v) => updateItem(index, 'name', v)} />

                        {mode === 1 && (
                            <View style={styles.imagePickerSection}>
                                <Text style={styles.label}>商品圖片 (置底顯示)</Text>
                                <TouchableOpacity style={styles.imageBox} onPress={() => pickImage(index)}>
                                    {item.imageUri ? (
                                        <Image source={{ uri: item.imageUri }} style={styles.previewImage} />
                                    ) : (
                                        <Text style={{ color: '#007AFF' }}>+ 點擊選取相片</Text>
                                    )}
                                </TouchableOpacity>
                                {item.imageUri && (
                                    <TouchableOpacity onPress={() => updateItem(index, 'imageUri', '')}>
                                        <Text style={styles.clearImageText}>移除圖片</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        {mode === 1 && <TextInput style={styles.input} placeholder="2. 原價" keyboardType="numeric" value={item.originalPrice} onChangeText={(v) => updateItem(index, 'originalPrice', v)} />}

                        <View style={styles.promoSection}>
                            <TextInput style={[styles.input, { color: 'red', fontWeight: 'bold' }]} placeholder="促銷資訊" value={item.promo} onChangeText={(v) => updateItem(index, 'promo', v)} />
                            <View style={styles.shortcutRow}>
                                <TouchableOpacity style={styles.tagBtn} onPress={() => updateItem(index, 'promo', '買 一 送 一')}><Text style={styles.tagText}>買一送一</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.tagBtn} onPress={() => updateItem(index, 'promo', '加 10 元 多 1 件')}><Text style={styles.tagText}>+10元</Text></TouchableOpacity>
                                <TouchableOpacity style={[styles.tagBtn, { backgroundColor: '#f0f0f0' }]} onPress={() => updateItem(index, 'promo', '')}><Text style={[styles.tagText, { color: '#666' }]}>清除</Text></TouchableOpacity>
                            </View>
                        </View>

                        <TextInput style={[styles.input, { fontSize: 20, color: 'red', fontWeight: 'bold' }]} placeholder="促銷金額" value={item.priceStr} onChangeText={(v) => updateItem(index, 'priceStr', v)} />
                        <TextInput style={styles.input} placeholder="活動日期" value={item.dateRange} onChangeText={(v) => updateItem(index, 'dateRange', v)} />
                    </View>
                ))}

                {mode === 8 && (
                    <View style={styles.buttonGroup}>
                        <TouchableOpacity style={styles.subButton} onPress={copyPrevious}><Text style={styles.subButtonText}>+ 同上</Text></TouchableOpacity>
                        <TouchableOpacity style={styles.subButton} onPress={addNew}><Text style={styles.subButtonText}>+ 新增</Text></TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.printButton} onPress={generatePDF}>
                    <Text style={styles.printButtonText}>產生 {mode === 1 ? '大海報' : '8 格標籤'}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#F2F2F7' },
    container: { padding: 15, paddingBottom: 130 },
    header: { fontSize: 22, fontWeight: 'bold', marginTop: 40, textAlign: 'center', marginBottom: 20 },
    modeSelector: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 20 },
    modeBtn: { paddingVertical: 10, paddingHorizontal: 25, borderRadius: 25, borderWidth: 1.5, borderColor: '#007AFF', backgroundColor: '#fff' },
    modeBtnActive: { backgroundColor: '#007AFF' },
    modeText: { color: '#007AFF', fontWeight: 'bold' },
    modeTextActive: { color: '#fff', fontWeight: 'bold' },
    itemCard: { backgroundColor: '#fff', borderRadius: 12, padding: 15, marginBottom: 15, elevation: 3 },
    itemIndex: { fontSize: 12, color: '#8E8E93', marginBottom: 5 },
    label: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, color: '#333' },
    input: { borderBottomWidth: 1, borderColor: '#E5E5EA', paddingVertical: 10, marginBottom: 10, fontSize: 16 },
    imagePickerSection: { marginBottom: 15, alignItems: 'center' },
    imageBox: { width: '100%', height: 150, backgroundColor: '#F2F2F7', borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 2, borderColor: '#D1D1D6' },
    previewImage: { width: '100%', height: '100%', borderRadius: 10, resizeMode: 'contain' },
    clearImageText: { color: '#FF3B30', marginTop: 8, fontSize: 13 },
    promoSection: { marginBottom: 10 },
    shortcutRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 5 },
    tagBtn: { backgroundColor: '#E8F2FF', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#007AFF' },
    tagText: { color: '#007AFF', fontSize: 12, fontWeight: '600' },
    buttonGroup: { flexDirection: 'row', justifyContent: 'space-between' },
    subButton: { backgroundColor: '#fff', padding: 15, borderRadius: 10, width: '48%', alignItems: 'center', borderWidth: 1, borderColor: '#007AFF' },
    subButtonText: { color: '#007AFF', fontWeight: 'bold' },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#D1D1D6' },
    printButton: { backgroundColor: '#34C759', padding: 18, borderRadius: 14, alignItems: 'center' },
    printButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' }
});