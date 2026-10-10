import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthProvider, useAuth } from "./src/auth";

type Category = { id: string; name: string };
type PublicTask = { id: string; title: string; description: string; currency: string; budgetMin: string | null; budgetMax: string | null; status: string };
type Screen = "home" | "tasks" | "details" | "create" | "applications";

function Field({ label, value, onChangeText, secureTextEntry = false, keyboardType = "default", multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; keyboardType?: "default" | "numeric" | "email-address"; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} keyboardType={keyboardType} multiline={multiline} autoCapitalize="none" style={[styles.input, multiline && { minHeight: 90, textAlignVertical: "top" }]} /></View>;
}

function AuthScreen() {
  const { login, register, error } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setMessage("");
    try {
      if (mode === "login") await login(email, password);
      else { await register(email, password); setMode("login"); setMessage("Registration successful. Sign in to continue."); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : error ?? "Request failed."); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.authCard}>
    <Text style={styles.brand}>Task Marketplace</Text><Text style={styles.title}>{mode === "login" ? "Sign in" : "Create your account"}</Text>
    <Text style={styles.muted}>Your account can operate across marketplace roles.</Text>
    <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
    <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</Text></Pressable>
    {(message || error) && <Text accessibilityRole="alert" style={styles.error}>{message || error}</Text>}
    <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}><Text style={styles.link}>{mode === "login" ? "Create an account" : "Back to sign in"}</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

function TaskFeed({ onSelect }: { onSelect: (taskId: string) => void }) {
  const { api } = useAuth();
  const [tasks, setTasks] = useState<PublicTask[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try { const result = await api<{ items: PublicTask[] }>("/api/v1/tasks/feed"); setTasks(result.items ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load tasks."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [api]);
  return <View>
    <Text style={styles.title}>Task Feed</Text><Text style={styles.muted}>Public tasks currently available for discovery.</Text>
    {loading ? <Text style={styles.muted}>Loading tasks…</Text> : error ? <View><Text style={styles.error}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.link}>Retry</Text></Pressable></View> : tasks.length === 0 ? <Text style={styles.muted}>No public tasks are available.</Text> :
      <View style={styles.grid}>{tasks.map(task => <Pressable key={task.id} accessibilityRole="button" onPress={() => onSelect(task.id)} style={styles.card}>
        <Text style={styles.cardText}>{task.title}</Text><Text style={styles.muted}>{task.description}</Text>
        <Text style={styles.cardMeta}>{task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</Text>
      </Pressable>)}</View>}
  </View>;
}

function TaskDetails({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { api, user } = useAuth();
  const [task, setTask] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(""); const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<Record<string, any>>("/api/v1/tasks/" + encodeURIComponent(taskId))
      .then(result => { if (!cancelled) setTask(result); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load task."); });
    return () => { cancelled = true; };
  }, [api, taskId]);
  async function apply() {
    setBusy(true); setError(null);
    try {
      await api("/api/v1/tasks/" + encodeURIComponent(taskId) + "/applications", { method: "POST", body: JSON.stringify({ proposedPrice: Number(price), ...(message.trim() ? { message: message.trim() } : {}) }) });
      setSubmitted(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit application."); }
    finally { setBusy(false); }
  }
  if (error && !task) return <View><Pressable onPress={onBack}><Text style={styles.link}>← Back to tasks</Text></Pressable><Text style={styles.error}>{error}</Text></View>;
  if (!task) return <Text style={styles.muted}>Loading task…</Text>;
  const location = task.location ? [task.location.area, task.location.city?.name, task.location.region?.name, task.location.country?.name].filter(Boolean).join(", ") : null;
  const canApply = user?.roles.includes("WORKER") && ["PUBLISHED", "RECEIVING_APPLICATIONS"].includes(task.status);
  return <View>
    <Pressable onPress={onBack}><Text style={styles.link}>← Back to tasks</Text></Pressable>
    <Text style={styles.title}>{task.title}</Text><Text style={styles.muted}>{task.category?.name} · {task.status}</Text>
    <Text style={styles.body}>{task.description}</Text><Text style={styles.body}>Budget: {task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</Text>
    <Text style={styles.body}>Type: {task.type} · Duration: {task.duration}</Text>
    {location ? <Text style={styles.body}>Location: {location}</Text> : null}
    {task.expectedCompletionAt ? <Text style={styles.body}>Expected completion: {new Date(task.expectedCompletionAt).toLocaleString()}</Text> : null}
    {task.requirements ? <><Text style={styles.section}>Requirements</Text><Text style={styles.body}>{task.requirements}</Text></> : null}
    {task.requirementsList?.length ? <><Text style={styles.section}>Task requirements</Text>{task.requirementsList.map((item: {id:string;name:string;value:string|null}) => <Text key={item.id} style={styles.body}>• {item.name}{item.value ? ": " + item.value : ""}</Text>)}</> : null}
    {task.attachments?.length ? <><Text style={styles.section}>Attachments</Text>{task.attachments.map((item: {id:string;fileName:string|null;fileType:string|null}) => <Text key={item.id} style={styles.body}>• {item.fileName ?? "Attachment"}{item.fileType ? " · " + item.fileType : ""}</Text>)}</> : null}
    {canApply ? <View style={styles.formSection}><Text style={styles.section}>Apply for this task</Text>{submitted ? <Text accessibilityRole="alert" style={styles.muted}>Application submitted.</Text> : <>
      <Field label={"Proposed price (" + task.currency + ")"} value={price} onChangeText={setPrice} keyboardType="numeric" />
      <Field label="Message (optional)" value={message} onChangeText={setMessage} multiline />
      <Text style={styles.muted}>The server checks eligibility and any required token cost.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy || !price.trim()} onPress={() => void apply()} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Submitting…" : "Submit application"}</Text></Pressable>
    </>}</View> : !user?.roles.includes("WORKER") ? <Text style={styles.muted}>A WORKER role is required to apply.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

function TaskCreate() {
  const { api, user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState(""); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [type, setType] = useState<"PHYSICAL" | "VIRTUAL">("PHYSICAL");
  const [duration, setDuration] = useState<"SHORT_TERM" | "LONG_TERM">("SHORT_TERM");
  const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [location, setLocation] = useState(""); const [requirements, setRequirements] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null); const [taskStatus, setTaskStatus] = useState<"DRAFT" | "PUBLISHED" | "RECEIVING_APPLICATIONS">("DRAFT");
  useEffect(() => {
    let cancelled = false;
    api<Category[]>("/api/v1/categories").then(items => { if (!cancelled) { setCategories(items); setCategoryId(items[0]?.id ?? ""); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load categories."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);
  async function create() {
    setBusy(true); setError(null);
    try {
      const task = await api<{id:string}>("/api/v1/tasks", { method: "POST", body: JSON.stringify({ categoryId, title: title.trim(), description: description.trim(), type, duration, ...(min !== "" ? { budgetMin: Number(min) } : {}), ...(max !== "" ? { budgetMax: Number(max) } : {}), ...(type === "PHYSICAL" ? { locationDescription: location.trim() } : {}), ...(requirements.trim() ? { requirements: requirements.trim() } : {}) }) });
      setTaskId(task.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create task."); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!taskId) return; setBusy(true); setError(null);
    try {
      let currentStatus = taskStatus;
      if (currentStatus === "DRAFT") {
        await api("/api/v1/tasks/" + taskId + "/publish", { method: "POST" });
        currentStatus = "PUBLISHED";
        setTaskStatus(currentStatus);
      }
      if (currentStatus === "PUBLISHED") {
        await api("/api/v1/tasks/" + taskId + "/open-applications", { method: "POST" });
        currentStatus = "RECEIVING_APPLICATIONS";
        setTaskStatus(currentStatus);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task created, but publishing did not finish."); }
    finally { setBusy(false); }
  }
  if (!user?.roles.includes("CLIENT")) return <Text style={styles.muted}>A CLIENT role is required to post tasks.</Text>;
  if (taskId) return <View><Text style={styles.title}>Draft created</Text><Text style={styles.muted}>Task reference: {taskId}</Text>{taskStatus === "RECEIVING_APPLICATIONS" ? <Text accessibilityRole="alert" style={styles.muted}>Task is published and receiving applications.</Text> : <Pressable disabled={busy} onPress={() => void publish()} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Publishing…" : taskStatus === "PUBLISHED" ? "Open applications" : "Publish and receive applications"}</Text></Pressable>}{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
  return <View><Text style={styles.title}>Post a task</Text><Text style={styles.muted}>Tasks are saved as drafts before you publish them.</Text>
    {loading ? <Text style={styles.muted}>Loading active categories…</Text> : error ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable onPress={() => { setLoading(true); setError(null); void api<Category[]>("/api/v1/categories").then(items => { setCategories(items); setCategoryId(items[0]?.id ?? ""); }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load categories.")).finally(() => setLoading(false)); }}><Text style={styles.link}>Retry categories</Text></Pressable></View> : categories.length === 0 ? <Text style={styles.muted}>No active categories available. Task creation is unavailable.</Text> : <>
      <Field label="Title" value={title} onChangeText={setTitle} /><Field label="Description" value={description} onChangeText={setDescription} multiline />
      <Text style={styles.label}>Category</Text>{categories.map(category => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.card, category.id === categoryId && styles.selected]}><Text style={styles.cardText}>{category.name}</Text></Pressable>)}
      <Text style={styles.label}>Task type</Text><View style={styles.row}>{(["PHYSICAL","VIRTUAL"] as const).map(value => <Pressable key={value} onPress={() => setType(value)} style={[styles.card, styles.choice, type === value && styles.selected]}><Text style={styles.cardText}>{value === "PHYSICAL" ? "Physical" : "Virtual"}</Text></Pressable>)}</View>
      <Text style={styles.label}>Duration</Text><View style={styles.row}>{(["SHORT_TERM","LONG_TERM"] as const).map(value => <Pressable key={value} onPress={() => setDuration(value)} style={[styles.card, styles.choice, duration === value && styles.selected]}><Text style={styles.cardText}>{value === "SHORT_TERM" ? "Short term" : "Long term"}</Text></Pressable>)}</View>
      <Field label="Minimum budget" value={min} onChangeText={setMin} keyboardType="numeric" /><Field label="Maximum budget" value={max} onChangeText={setMax} keyboardType="numeric" />
      {type === "PHYSICAL" ? <Field label="General location" value={location} onChangeText={setLocation} /> : null}
      <Field label="Requirements (optional)" value={requirements} onChangeText={setRequirements} multiline />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy || !categoryId || title.trim().length < 3 || !description.trim() || (type === "PHYSICAL" && !location.trim())} onPress={() => void create()} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Creating…" : "Create draft"}</Text></Pressable>
    </>}
  </View>;
}

function AuthenticatedShell() {
  const { user, logout } = useAuth();
  const [screen, setScreen] = useState<Screen>("home");
  const [taskId, setTaskId] = useState<string | null>(null);
  const openTask = (id: string) => { setTaskId(id); setScreen("details"); };
  const navigate = (next: Screen) => setScreen(next);
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Text style={styles.brandSmall}>Task Marketplace</Text><Pressable accessibilityRole="button" onPress={() => void logout()}><Text style={styles.link}>Log out</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.content}>
      {screen === "tasks" ? <TaskFeed onSelect={openTask} /> : screen === "details" && taskId ? <TaskDetails taskId={taskId} onBack={() => setScreen("tasks")} /> : screen === "create" ? <TaskCreate /> : screen === "applications" ? <View><Text style={styles.title}>Applications</Text><Text style={styles.muted}>Choose a public task and submit your proposal from its details page. The API verifies your worker role and eligibility.</Text><Pressable onPress={() => navigate("tasks")} style={styles.primary}><Text style={styles.primaryText}>Browse tasks</Text></Pressable></View> : <>
        <Text style={styles.title}>Home</Text><Text style={styles.muted}>{user?.email}</Text>
        <Text style={styles.muted}>The API remains authoritative for permissions and business rules.</Text>
        <View style={styles.grid}>
          <Pressable onPress={() => navigate("tasks")} style={styles.card}><Text style={styles.cardText}>Task Feed</Text></Pressable>
          {user?.roles.includes("CLIENT") ? <Pressable onPress={() => navigate("create")} style={styles.card}><Text style={styles.cardText}>Post Task</Text></Pressable> : null}
          {user?.roles.includes("WORKER") ? <Pressable onPress={() => navigate("applications")} style={styles.card}><Text style={styles.cardText}>Applications</Text></Pressable> : null}
        </View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

function AppContent() {
  const { user, loading } = useAuth();
  const [splash, setSplash] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }), Animated.timing(translate, { toValue: 0, duration: 650, useNativeDriver: true })]).start();
    const timer = setTimeout(() => setSplash(false), 2300);
    return () => clearTimeout(timer);
  }, [opacity, translate]);
  if (splash || loading) return <View style={styles.splash}><Animated.View style={{ opacity, transform: [{ translateY: translate }] }}><Text style={styles.logo}>Task Marketplace</Text></Animated.View></View>;
  return user ? <AuthenticatedShell /> : <AuthScreen />;
}

export default function App() { return <AuthProvider><AppContent /></AuthProvider>; }

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:"#fff"}, splash:{flex:1,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},
  logo:{fontSize:34,fontWeight:"800",letterSpacing:-1.6,color:"#171717"},
  header:{minHeight:64,borderBottomWidth:1,borderBottomColor:"#e5e7eb",justifyContent:"space-between",alignItems:"center",flexDirection:"row",paddingHorizontal:20},
  brand:{fontSize:22,fontWeight:"800",color:"#171717",marginBottom:8}, brandSmall:{fontSize:18,fontWeight:"700",color:"#171717"},
  content:{padding:24,paddingBottom:48}, authCard:{padding:24,gap:14,maxWidth:520,width:"100%",alignSelf:"center"},
  title:{fontSize:30,fontWeight:"700",color:"#171717",marginBottom:4}, muted:{fontSize:15,color:"#6b7280",lineHeight:23,marginBottom:8},
  field:{gap:6,marginVertical:6}, label:{fontSize:14,fontWeight:"600",color:"#171717",marginTop:8},
  input:{borderWidth:1,borderColor:"#e5e7eb",borderRadius:8,paddingHorizontal:12,paddingVertical:11,fontSize:16,color:"#171717"},
  primary:{minHeight:46,borderRadius:8,backgroundColor:"#111827",alignItems:"center",justifyContent:"center",paddingHorizontal:18,marginVertical:8},
  primaryText:{color:"#fff",fontWeight:"700",fontSize:15}, link:{color:"#111827",fontWeight:"600"}, error:{color:"#991b1b",lineHeight:22,marginVertical:8},
  grid:{marginTop:24,gap:12}, card:{borderWidth:1,borderColor:"#e5e7eb",borderRadius:10,padding:18,backgroundColor:"#fafafa",marginVertical:5},
  cardText:{fontSize:16,fontWeight:"600",color:"#171717"}, cardMeta:{fontSize:14,fontWeight:"600",color:"#171717",marginTop:8},
  body:{fontSize:15,color:"#171717",lineHeight:23,marginTop:10}, section:{fontSize:19,fontWeight:"700",color:"#171717",marginTop:24,marginBottom:4},
  row:{flexDirection:"row",gap:8}, choice:{flex:1}, selected:{borderColor:"#111827",backgroundColor:"#f3f4f6"}, formSection:{marginTop:24,borderTopWidth:1,borderTopColor:"#e5e7eb",paddingTop:12}
});
