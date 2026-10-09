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

function TaskFeed({ onSelect }: { onSelect: (taskId: string) => void }) {
  const { api } = useAuth();
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; description: string; currency: string; budgetMin: string | null; budgetMax: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: typeof tasks }>("/api/v1/tasks/feed")
      .then((result) => { if (!cancelled) setTasks(result.items ?? []); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load tasks."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  return <View>
    <Text style={styles.title}>Task Feed</Text>
    <Text style={styles.muted}>Public tasks currently accepting marketplace discovery.</Text>
    {loading ? <Text style={styles.muted}>Loading tasks…</Text> : error ? <Text style={styles.error}>{error}</Text> : tasks.length === 0 ? <Text style={styles.muted}>No public tasks are available.</Text> :
      <View style={styles.grid}>{tasks.map(task => <Pressable key={task.id} accessibilityRole="button" onPress={() => onSelect(task.id)} style={styles.card}>
        <Text style={styles.cardText}>{task.title}</Text>
        <Text style={styles.muted}>{task.description}</Text>
        <Text style={styles.cardMeta}>{task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</Text>
      </Pressable>)}</View>}
  </View>;
}

function TaskDetails({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { api } = useAuth();
  const [task, setTask] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<any>("/api/v1/tasks/" + taskId)
      .then(result => { if (!cancelled) setTask(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load task."); });
    return () => { cancelled = true; };
  }, [api, taskId]);

  if (error) return <View><Pressable onPress={onBack}><Text style={styles.link}>← Back to tasks</Text></Pressable><Text style={styles.error}>{error}</Text></View>;
  if (!task) return <View><Text style={styles.muted}>Loading task…</Text></View>;

  const location = task.location ? [task.location.area, task.location.city?.name, task.location.region?.name, task.location.country?.name].filter(Boolean).join(", ") : null;
  return <View>
    <Pressable onPress={onBack}><Text style={styles.link}>← Back to tasks</Text></Pressable>
    <Text style={styles.title}>{task.title}</Text>
    <Text style={styles.muted}>{task.category?.name} · {task.status}</Text>
    <Text style={styles.body}>{task.description}</Text>
    <Text style={styles.body}>Budget: {task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</Text>
    <Text style={styles.body}>Type: {task.type} · Duration: {task.duration}</Text>
    {location ? <Text style={styles.body}>Location: {location}</Text> : null}
    {task.expectedCompletionAt ? <Text style={styles.body}>Expected completion: {new Date(task.expectedCompletionAt).toLocaleString()}</Text> : null}
    {task.requirements ? <><Text style={styles.section}>Requirements</Text><Text style={styles.body}>{task.requirements}</Text></> : null}
    {task.requirementsList?.length ? <><Text style={styles.section}>Task requirements</Text>{task.requirementsList.map((item: {id:string;name:string;value:string|null}) => <Text key={item.id} style={styles.body}>• {item.name}{item.value ? ": " + item.value : ""}</Text>)}</> : null}
    {task.attachments?.length ? <><Text style={styles.section}>Attachments</Text>{task.attachments.map((item: {id:string;fileName:string|null;fileType:string|null}) => <Text key={item.id} style={styles.body}>• {item.fileName ?? "Attachment"}{item.fileType ? " · " + item.fileType : ""}</Text>)}</> : null}
  </View>;
}

function AuthenticatedShell() {
  const { user, logout } = useAuth();
  const [screen, setScreen] = useState<"home" | "tasks" | "details">("home");
  const [taskId, setTaskId] = useState<string | null>(null);
  const openTask = (id: string) => { setTaskId(id); setScreen("details"); };
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Text style={styles.brandSmall}>Task Marketplace</Text><Pressable accessibilityRole="button" onPress={() => void logout()}><Text style={styles.link}>Log out</Text></Pressable></View><View style={styles.content}>
    {screen === "tasks" ? <TaskFeed onSelect={openTask} /> : screen === "details" && taskId ? <TaskDetails taskId={taskId} onBack={() => setScreen("tasks")} /> : <>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.muted}>{user?.email}</Text>
      <Text style={styles.muted}>Authenticated session established. The API remains authoritative for permissions and business rules.</Text>
      <View style={styles.grid}>{nav.map(item => <Pressable key={item} accessibilityRole="button" onPress={() => item === "Task Feed" && setScreen("tasks")} style={styles.card}><Text style={styles.cardText}>{item}</Text></Pressable>)}</View>
    </>}
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
  cardText:{fontSize:16,fontWeight:"600",color:"#171717"},\n  cardMeta:{fontSize:14,fontWeight:"600",color:"#171717",marginTop:8},\n  body:{fontSize:15,color:"#171717",lineHeight:23,marginTop:10},\n  section:{fontSize:19,fontWeight:"700",color:"#171717",marginTop:24,marginBottom:4}
});
