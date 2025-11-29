import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Test screen to verify NativeWind is working correctly
 * This demonstrates the same Tailwind classes work in React Native
 */
export default function NativeWindTestScreen() {
  return (
    <SafeAreaView className="flex-1 bg-asp-dark">
      <ScrollView className="flex-1 p-6">
        <Text className="text-4xl font-bold text-white mb-2">
          NativeWind Test
        </Text>
        <Text className="text-base text-text-secondary mb-8">
          Testing Tailwind CSS classes in React Native
        </Text>

        {/* Glass Card - matches web app styling */}
        <View className="bg-glass border border-glass-border rounded-2xl p-6 mb-4">
          <Text className="text-xl font-semibold text-white mb-2">
            Glass Card Effect
          </Text>
          <Text className="text-sm text-text-secondary">
            This card uses the same glassmorphism style as the web app
          </Text>
        </View>

        {/* Primary Button - matches web app */}
        <Pressable className="bg-white rounded-lg px-6 py-4 mb-4 active:opacity-90">
          <Text className="text-asp-dark text-center font-semibold text-base">
            Primary Button
          </Text>
        </Pressable>

        {/* Secondary Button - matches web app */}
        <Pressable className="bg-input-bg border border-input-border rounded-lg px-6 py-4 mb-4 active:opacity-80">
          <Text className="text-white text-center font-semibold text-base">
            Secondary Button
          </Text>
        </Pressable>

        {/* Metric Cards - like dashboard */}
        <View className="flex-row gap-3 mb-4">
          <View className="flex-1 bg-glass border border-glass-border rounded-xl p-4">
            <Text className="text-xs text-text-tertiary mb-1">Workouts</Text>
            <Text className="text-2xl font-bold text-white">12</Text>
          </View>
          <View className="flex-1 bg-glass border border-glass-border rounded-xl p-4">
            <Text className="text-xs text-text-tertiary mb-1">This Week</Text>
            <Text className="text-2xl font-bold text-asp-blue-light">4</Text>
          </View>
        </View>

        {/* Color Palette Test */}
        <Text className="text-lg font-semibold text-white mt-6 mb-3">
          Color Palette
        </Text>
        <View className="flex-row flex-wrap gap-3 mb-8">
          <View className="bg-asp-blue rounded-lg p-3 min-w-[80px]">
            <Text className="text-white text-xs font-medium">ASP Blue</Text>
          </View>
          <View className="bg-asp-blue-light rounded-lg p-3 min-w-[80px]">
            <Text className="text-asp-dark text-xs font-medium">Blue Light</Text>
          </View>
          <View className="bg-glass border border-glass-border rounded-lg p-3 min-w-[80px]">
            <Text className="text-white text-xs font-medium">Glass</Text>
          </View>
        </View>

        {/* Border Radius Test */}
        <Text className="text-lg font-semibold text-white mb-3">
          Border Radius
        </Text>
        <View className="flex-row gap-3 mb-8">
          <View className="bg-white rounded-lg p-4">
            <Text className="text-asp-dark text-xs">lg (8px)</Text>
          </View>
          <View className="bg-white rounded-xl p-4">
            <Text className="text-asp-dark text-xs">xl (10px)</Text>
          </View>
          <View className="bg-white rounded-2xl p-4">
            <Text className="text-asp-dark text-xs">2xl (12px)</Text>
          </View>
        </View>

        {/* Success Message */}
        <View className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <Text className="text-green-400 font-semibold mb-1">
            ✅ NativeWind Setup Complete!
          </Text>
          <Text className="text-green-300 text-sm">
            All Tailwind classes are working correctly. You can now convert pages from the web app using the same class names.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
