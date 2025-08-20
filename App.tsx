// App.tsx
import React from "react";
import { SafeAreaView, StyleSheet, View, Platform } from "react-native";
import SubtitleVideoPlayer from "./components/SubtitleVideoPlayer";

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <SubtitleVideoPlayer
          autoPlay={false}
          controls={false}
          captionFontSize={18}
          width={Platform.OS === "web" ? "98%" : "100%"}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f0f0f0"
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
});
