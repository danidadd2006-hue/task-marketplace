import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthProvider, useAuth } from "./src/auth";

const nav = ["Home", "Task Feed", "Post Task", "Applications", "Messages", "Notifications", "Profile", "Settings"];

function Field({ label, value, onChangeText, secureTextEntry = false }: { label: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} autoCapitalize="none" style={styles.input} /></View>;
}

function AuthScreen() {
  const { login, register, error } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") await login(email, password);
      else { await register(email, password); setMode("login"); setMessage("Registration successful. Sign in to continue."); }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : error ?? "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return <SafeAreaView style={styles.safe}><View style={styles.authCard}>
    <Text style={styles.brand}>Task Marketplace</Text>
    <Text style={styles.title}>{mode === "login" ? "Sign in" : "Create your account"}</Text>
    <Text style={styles.muted}>Your account can operate across marketplace roles.</Text>
    <Field label="Email" value={email} onChangeText={setEmail} />
    <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</Text></Pressable>
    {(message || error) && <Text accessibilityRole="alert" style={styles.error}>{message || error}</Text>}
    <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}><Text style={styles.link}>{mode === "login" ? "Create an account" : "Back to sign in"}</Text></Pressable>
  </View></SafeAreaView>;
}

function AuthenticatedShell() {
  const { user, logout } = useAuth();
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Text style={styles.brandSmall}>Task Marketplace</Text><Pressable accessibilityRole="button" onPress={() => void logout()}><Text style={styles.link}>Log out</Text></Pressable></View><View style={styles.content}>
    <Text style={styles.title}>Home</Text>
    <Text style={styles.muted}>{user?.email}</Text>
    <Text style={styles.muted}>Authenticated session established. The API remains authoritative for permissions and business rules.</Text>
    <View style={styles.grid}>{nav.map(item => <Pressable key={item} accessibilityRole="button" style={styles.card}><Text style={styles.cardText}>{item}</Text></Pressable>)}</View>
  </View></SafeAreaView>;
}

function AppContent() {
  const { user, loading } = useAuth();
  const [splash, setSplash] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 650, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => setSplash(false), 2300);
    return () => clearTimeout(timer);
  }, [opacity, translate]);

  if (splash || loading) return <View style={styles.splash}><Animated.View style={{ opacity, transform: [{ translateY: translate }] }}><Text style={styles.logo}>Task Marketplace</Text></Animated.View></View>;
  return user ? <AuthenticatedShell /> : <AuthScreen />;
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:"#fff"},
  splash:{flex:1,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},
  logo:{fontSize:34,fontWeight:"800",letterSpacing:-1.6,color:"#171717"},
  header:{minHeight:64,borderBottomWidth:1,borderBottomColor:"#e5e7eb",justifyContent:"space-between",alignItems:"center",flexDirection:"row",paddingHorizontal:20},
  brand:{fontSize:22,fontWeight:"800",color:"#171717",marginBottom:8},
  brandSmall:{fontSize:18,fontWeight:"700",color:"#171717"},
  content:{padding:24},
  authCard:{padding:24,gap:14,maxWidth:520,width:"100%",alignSelf:"center"},
  title:{fontSize:30,fontWeight:"700",color:"#171717",marginBottom:4},
  muted:{fontSize:15,color:"#6b7280",lineHeight:23,marginBottom:8},
  field:{gap:6},
  label:{fontSize:14,fontWeight:"600",color:"#171717"},
  input:{borderWidth:1,borderColor:"#e5e7eb",borderRadius:8,paddingHorizontal:12,paddingVertical:11,fontSize:16,color:"#171717"},
  primary:{minHeight:46,borderRadius:8,backgroundColor:"#111827",alignItems:"center",justifyContent:"center",paddingHorizontal:18},
  primaryText:{color:"#fff",fontWeight:"700",fontSize:15},
  link:{color:"#111827",fontWeight:"600"},
  error:{color:"#991b1b",lineHeight:22},
  grid:{marginTop:24,gap:12},
  card:{borderWidth:1,borderColor:"#e5e7eb",borderRadius:10,padding:18,backgroundColor:"#fafafa"},
  cardText:{fontSize:16,fontWeight:"600",color:"#171717"}
});
