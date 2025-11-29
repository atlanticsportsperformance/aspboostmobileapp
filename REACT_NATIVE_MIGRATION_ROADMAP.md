# ASPBoost Mobile - React Native Migration Roadmap

## 🎯 OBJECTIVE
Convert ALL athlete-facing pages from the Next.js web app into React Native components with **EXACT** visual parity - same layouts, colors, buttons, functions, and user experience.

## ⚠️ IMPORTANT NOTES
- This migration does NOT affect the existing web app
- Each page will be converted one-by-one systematically
- We'll maintain exact visual consistency using the same design tokens
- All functionality must work identically to the web version

---

## 📱 TOTAL PAGES TO MIGRATE: 23

---

# PHASE 1: AUTHENTICATION & ONBOARDING (4 Pages)

## 1.1 - Sign In Page
**Web App Path**: `/app/(auth)/sign-in/page.tsx`
**Mobile Route**: `/sign-in`
**Priority**: 🔴 CRITICAL (First page users see)
**Complexity**: Medium
**Lines of Code**: ~280 lines

### Features to Replicate:
- [ ] Email/password input fields (exact styling)
- [ ] "Remember me" checkbox
- [ ] Animated gradient background (same colors)
- [ ] PWA install banner detection (adapt for React Native)
- [ ] "Forgot password" link
- [ ] Error handling for inactive accounts (same error messages)
- [ ] Loading states during authentication
- [ ] Auto-redirect after successful login

### Design Elements:
- Background gradient: Blue to purple animation
- Input fields: White background, rounded corners
- Button: Primary blue color with hover states
- Typography: Same font sizes and weights

### Dependencies/APIs:
- Supabase authentication
- Secure token storage (AsyncStorage or SecureStore)

---

## 1.2 - Join Group via Invite Link
**Web App Path**: `/app/(public)/join/[token]/page.tsx`
**Mobile Route**: `/join/:token`
**Priority**: 🔴 CRITICAL (Athlete onboarding)
**Complexity**: High
**Lines of Code**: ~360 lines

### Features to Replicate:
- [ ] Token validation from URL
- [ ] Registration form with all fields:
  - Full name
  - Email
  - Password (with confirmation)
  - Date of birth (date picker)
  - Play level dropdown
  - Position input
  - Graduation year
- [ ] Group information display
- [ ] Automatic account creation
- [ ] Auto-login after registration
- [ ] Error handling for invalid/expired tokens

### Design Elements:
- Form layout: Vertical stack with consistent spacing
- Input validation: Real-time feedback
- Submit button: Full-width at bottom
- Success animation on completion

### Dependencies/APIs:
- Token verification endpoint
- Athlete creation API
- Group assignment logic

---

## 1.3 - Update Password
**Web App Path**: `/app/(auth)/update-password/page.tsx`
**Mobile Route**: `/update-password`
**Priority**: 🟡 MEDIUM
**Complexity**: Low
**Lines of Code**: ~150 lines (estimated)

### Features to Replicate:
- [ ] Password reset form
- [ ] New password input with confirmation
- [ ] Password strength indicator
- [ ] Success message
- [ ] Auto-redirect to sign-in

---

## 1.4 - Sign Up (Facility Owner)
**Web App Path**: `/app/(auth)/sign-up/page.tsx`
**Mobile Route**: `/sign-up`
**Priority**: 🟢 LOW (Athletes don't use this)
**Complexity**: Medium
**Lines of Code**: ~300 lines (estimated)

### Notes:
- This is primarily for facility owners/coaches
- May skip for initial mobile release (athlete-only app)
- Can be added later if needed

---

# PHASE 2: MAIN DASHBOARD (1 Page - COMPLEX)

## 2.1 - Athlete Dashboard Home
**Web App Path**: `/app/athlete-dashboard/page.tsx`
**Component**: `/components/dashboard/athletes/athlete-dashboard.tsx`
**Mobile Route**: `/dashboard`
**Priority**: 🔴 CRITICAL (Main hub)
**Complexity**: Very High
**Lines of Code**: ~200+ lines (needs componentization)

### Features to Replicate:
- [ ] **Workout Calendar View**
  - Current week workout schedule
  - Date navigation
  - Workout status indicators (completed/pending)
  - Tap to view workout details

- [ ] **Force Profile Overview Carousel**
  - Swipeable cards showing latest test results
  - CMJ, SJ, HJ, PPU, IMTP metrics
  - Percentile displays
  - Tap to view full force profile

- [ ] **Hitting Performance Section**
  - Latest bat speed metrics
  - Exit velocity
  - Attack angle
  - Tap to view full hitting analytics

- [ ] **Pitching/ArmCare Section**
  - Shoulder health scores
  - Latest Motus data
  - Recovery status

- [ ] **Nutrition Section**
  - Active meal plan display
  - Macros summary

- [ ] **Assessments Section**
  - Latest assessment date
  - Quick access to view report

- [ ] **Parent Account Support**
  - Multi-athlete switcher at top
  - Color-coded athlete indicators
  - Welcome modal for first-time parents

- [ ] **FAB Navigation** (Floating Action Button)
  - Bottom-right floating button
  - Opens navigation menu
  - Links to all major sections

### Design Elements:
- Card-based layout with consistent padding
- Section headers with icons
- Skeleton loaders for data fetching
- Pull-to-refresh functionality
- Smooth scroll animations

### REFACTORING NEEDED BEFORE MIGRATION:
This component should be broken down into:
1. `DashboardHeader.tsx` - Welcome message, athlete switcher
2. `WorkoutCalendarSection.tsx` - Calendar widget
3. `ForceProfileCarousel.tsx` - Force metrics carousel
4. `HittingPerformanceCard.tsx` - Hitting summary
5. `ArmCareCard.tsx` - Pitching/armcare summary
6. `NutritionCard.tsx` - Nutrition summary
7. `AssessmentsCard.tsx` - Assessment link
8. `DashboardFAB.tsx` - Floating action button

---

# PHASE 3: WORKOUT FEATURES (1 Page - MOST COMPLEX)

## 3.1 - Workout Execution/Logger
**Web App Path**: `/app/athlete-dashboard/workouts/[instance-id]/execute/page.tsx`
**Mobile Route**: `/workouts/:instanceId/execute`
**Priority**: 🔴 CRITICAL (Core feature)
**Complexity**: EXTREMELY HIGH
**Lines of Code**: 26,817+ tokens (MASSIVE FILE)

### ⚠️ CRITICAL: THIS IS THE LARGEST PAGE - MUST BE COMPONENTIZED FIRST

### Features to Replicate:
- [ ] **Exercise Navigation**
  - Current exercise display
  - Previous/Next navigation buttons
  - Exercise progress indicator (e.g., "3 of 8")

- [ ] **Set Logging Interface**
  - Set number display
  - Weight input (numeric keyboard)
  - Reps input (numeric keyboard)
  - RPE slider (1-10 scale)
  - AMRAP toggle for last set
  - "Complete Set" button
  - Previous set data reference

- [ ] **Superset Handling**
  - Grouped exercise display
  - Round-based navigation
  - Exercise switching within superset

- [ ] **Rest Timer**
  - Automatic countdown after set completion
  - Skip rest button
  - Audio/vibration alert when rest complete

- [ ] **Progress Tracking**
  - Sets completed vs. total
  - Visual progress bar
  - Workout completion percentage

- [ ] **Exercise Details Panel**
  - Exercise name and description
  - Demo video/image
  - Tempo display (e.g., "3-1-1-0")
  - Notes from coach

- [ ] **Workout Controls**
  - Save progress (draft mode)
  - Complete workout
  - Exit workout (with confirmation)
  - Delete workout instance

- [ ] **Mobile Optimizations**
  - Prevent screen lock during workout
  - Haptic feedback on button presses
  - Large touch targets for inputs
  - Quick number pad access

### Design Elements:
- Full-screen immersive interface
- Large, readable text for exercise names
- Color-coded set status (pending/completed)
- Smooth transitions between exercises
- Bottom sheet for exercise details
- Sticky header with workout info

### REFACTORING NEEDED BEFORE MIGRATION:
This MUST be broken into smaller components:
1. `WorkoutHeader.tsx` - Title, progress, exit button
2. `ExerciseCard.tsx` - Current exercise display
3. `SetLogger.tsx` - Individual set input form
4. `SetHistoryList.tsx` - Completed sets display
5. `RestTimer.tsx` - Countdown timer component
6. `ExerciseNavigator.tsx` - Prev/Next buttons
7. `SupersetRoundNavigator.tsx` - Round indicator for supersets
8. `ExerciseDetailSheet.tsx` - Bottom sheet with demo/notes
9. `WorkoutCompleteModal.tsx` - Success screen
10. `WorkoutExitDialog.tsx` - Confirmation dialog

### Dependencies/APIs:
- Workout instance data fetch
- Set logging API (create/update)
- Workout completion API
- Exercise media URLs

---

# PHASE 4: PROFILE & SETTINGS (2 Pages)

## 4.1 - Athlete Profile
**Web App Path**: `/app/athlete-dashboard/profile/page.tsx`
**Mobile Route**: `/profile`
**Priority**: 🟡 MEDIUM
**Complexity**: Medium
**Lines of Code**: ~700 lines

### Features to Replicate:
- [ ] **Profile Information Section**
  - Avatar display (or initials circle)
  - Full name (editable)
  - Email (display only)
  - Phone number (editable)
  - Date of birth (date picker)
  - Position (editable)
  - Graduation year (editable)
  - Height (feet/inches picker)
  - Weight (pounds input)

- [ ] **Play Level Selection**
  - Dropdown with levels (affects force percentiles)
  - Options: Youth, High School, College, Professional

- [ ] **Password Change**
  - Current password input
  - New password input
  - Confirm password input
  - Change password button

- [ ] **Account Information**
  - Organization name (display only)
  - Account type (display only)
  - Member since date

### Design Elements:
- Sectioned form layout
- Save button at top-right
- Inline editing with auto-save
- Success toasts for updates

### REFACTORING NEEDED:
Break into:
1. `ProfileHeader.tsx` - Avatar and name
2. `PersonalInfoForm.tsx` - Editable fields
3. `PlayLevelSelector.tsx` - Level dropdown
4. `PasswordChangeForm.tsx` - Password section
5. `AccountInfo.tsx` - Read-only account details

---

## 4.2 - Linked Accounts (Parent Feature)
**Web App Path**: `/app/athlete-dashboard/linked-accounts/page.tsx`
**Mobile Route**: `/linked-accounts`
**Priority**: 🟡 MEDIUM (Parent accounts only)
**Complexity**: Medium
**Lines of Code**: ~440 lines

### Features to Replicate:
- [ ] List of all linked athlete accounts
- [ ] Color-coded athlete indicators
- [ ] Quick switch between athletes
- [ ] "Request to link" new athlete button
- [ ] Quick booking access per athlete
- [ ] Unlink account option

### Design Elements:
- Card-based athlete list
- Color dots for visual distinction
- Swipe actions for quick access

---

# PHASE 5: PERFORMANCE & ANALYTICS (3 Pages)

## 5.1 - Performance Dashboard
**Web App Path**: `/app/athlete-dashboard/performance/page.tsx`
**Mobile Route**: `/performance`
**Priority**: 🟡 MEDIUM
**Complexity**: Medium
**Lines of Code**: ~100 lines (well-componentized)

### Features to Replicate:
- [ ] **View Mode Toggle**
  - "Personal Records" tab
  - "Exercise History" tab

- [ ] **Personal Records View**
  - List of max lifts per exercise
  - PR badges
  - Date achieved

- [ ] **Exercise History View**
  - Exercise selector dropdown
  - Historical chart (line graph)
  - Trend analysis

### Design Elements:
- Tab navigation at top
- Scrollable exercise list
- Interactive charts (recharts equivalent in RN)

### Components Used:
- `MaxTrackerPanel`
- `PerformanceAnalyticsView`
- `MaxTrendsDashboard`

---

## 5.2 - Force Profile Overview
**Web App Path**: `/app/athlete-dashboard/force-profile/page.tsx`
**Mobile Route**: `/force-profile`
**Priority**: 🟡 MEDIUM
**Complexity**: Medium
**Lines of Code**: ~100 lines

### Features to Replicate:
- [ ] Force profile radar chart (composite)
- [ ] Test type navigation buttons (CMJ, SJ, HJ, PPU, IMTP)
- [ ] Percentile scores per test
- [ ] Latest test date
- [ ] Tap test button to view details

### Design Elements:
- Radar chart visualization
- Horizontal scrolling test buttons
- Metric cards with percentile indicators

---

## 5.3 - Individual Force Test Details
**Web App Path**: `/app/athlete-dashboard/tests/[testType]/page.tsx`
**Mobile Route**: `/tests/:testType`
**Priority**: 🟢 LOW
**Complexity**: Low
**Lines of Code**: ~50 lines

### Features to Replicate:
- [ ] Test-specific metrics display
- [ ] Historical trend chart
- [ ] Percentile comparison
- [ ] Test date

---

# PHASE 6: HITTING & PITCHING (5 Pages)

## 6.1 - Hitting Performance Overview
**Web App Path**: `/app/athlete-dashboard/hitting-performance/page.tsx`
**Mobile Route**: `/hitting`
**Priority**: 🟡 MEDIUM
**Complexity**: Medium
**Lines of Code**: ~50 lines (delegates to component)

### Features to Replicate:
- [ ] Latest metrics summary (bat speed, exit velo, attack angle)
- [ ] Session history list
- [ ] Tap session to view details
- [ ] Trend charts for key metrics

### Component Used:
- `AthleteHittingPerformance`

---

## 6.2 - Hitting Trends
**Web App Path**: `/app/athlete-dashboard/hitting-performance/trends/page.tsx`
**Mobile Route**: `/hitting/trends`
**Priority**: 🟢 LOW
**Complexity**: Medium

### Features to Replicate:
- [ ] Multi-metric trend lines
- [ ] Date range selector
- [ ] Compare metrics side-by-side

---

## 6.3 - Batted Ball Trends
**Web App Path**: `/app/athlete-dashboard/hitting-performance/batted-ball-trends/page.tsx`
**Mobile Route**: `/hitting/batted-ball-trends`
**Priority**: 🟢 LOW
**Complexity**: Medium

### Features to Replicate:
- [ ] Batted ball data visualization
- [ ] Launch angle distribution
- [ ] Exit velocity heat maps

---

## 6.4 - Individual Hitting Session
**Web App Path**: `/app/athlete-dashboard/hitting-performance/session/[sessionId]/page.tsx`
**Mobile Route**: `/hitting/session/:sessionId`
**Priority**: 🟡 MEDIUM
**Complexity**: Medium

### Features to Replicate:
- [ ] Swing-by-swing data
- [ ] Session summary metrics
- [ ] Video playback (if available)
- [ ] Comparison to previous sessions

---

## 6.5 - ArmCare Dashboard
**Web App Path**: `/app/athlete-dashboard/armcare/page.tsx`
**Mobile Route**: `/armcare`
**Priority**: 🟡 MEDIUM
**Complexity**: Low
**Lines of Code**: ~55 lines

### Features to Replicate:
- [ ] Shoulder strength scores
- [ ] Arm health rating
- [ ] Session history
- [ ] Recovery recommendations

### Component Used:
- `AthleteArmCareDetail`

---

# PHASE 7: NUTRITION (1 Page)

## 7.1 - Nutrition Dashboard
**Web App Path**: `/app/athlete-dashboard/nutrition/page.tsx`
**Mobile Route**: `/nutrition`
**Priority**: 🟢 LOW
**Complexity**: Low
**Lines of Code**: ~50 lines

### Features to Replicate:
- [ ] Active meal plan display
- [ ] Daily macro targets
- [ ] Meal suggestions
- [ ] Hydration tracking

### Component Used:
- `AthleteNutrition`

---

# PHASE 8: COMMUNICATION (1 Page - COMPLEX)

## 8.1 - Messages
**Web App Path**: `/app/athlete-dashboard/messages/page.tsx`
**Mobile Route**: `/messages`
**Priority**: 🟡 MEDIUM
**Complexity**: Very High
**Lines of Code**: ~1,034 lines

### Features to Replicate:
- [ ] **Conversation List**
  - List of conversations with coaches
  - Last message preview
  - Unread badge count
  - Timestamp of last message
  - Tap to open conversation

- [ ] **Message Thread**
  - Full-screen conversation view
  - Message bubbles (sent/received styling)
  - Timestamp per message
  - Read status indicators

- [ ] **Message Composition**
  - Text input at bottom
  - Send button
  - File attachment button
  - Image/video picker integration

- [ ] **File Attachments**
  - Image preview in messages
  - Video playback
  - Document download
  - File size/type indicators

- [ ] **Real-Time Updates**
  - Supabase subscriptions for new messages
  - Auto-scroll to latest message
  - Typing indicators (if available)

- [ ] **New Conversation**
  - Coach selector
  - Create new thread

### Design Elements:
- Two-column layout on tablet (list + thread)
- Full-screen on phone (navigation between list/thread)
- Chat bubble styling (blue for sent, gray for received)
- Attachment thumbnails inline

### REFACTORING NEEDED:
Break into:
1. `ConversationList.tsx` - List of threads
2. `ConversationListItem.tsx` - Individual thread preview
3. `MessageThread.tsx` - Full conversation view
4. `MessageBubble.tsx` - Individual message component
5. `MessageInput.tsx` - Composition bar
6. `MessageAttachmentPicker.tsx` - File selection
7. `MessageAttachmentsDisplay.tsx` - Attachment rendering
8. `NewConversationModal.tsx` - Start new thread

---

# PHASE 9: RESOURCES (1 Page)

## 9.1 - Resources Library
**Web App Path**: `/app/athlete-dashboard/resources/page.tsx`
**Mobile Route**: `/resources`
**Priority**: 🟢 LOW
**Complexity**: Medium
**Lines of Code**: ~308 lines

### Features to Replicate:
- [ ] **File Type Filter**
  - All / Images / Videos / Documents tabs

- [ ] **Resource Grid**
  - Thumbnail previews for images/videos
  - File icons for documents
  - File name display
  - Upload date
  - File size

- [ ] **Resource Actions**
  - Tap to preview (images/videos)
  - Download button
  - Share functionality

- [ ] **Coach Notes**
  - Display note with each resource
  - Uploader name

### Design Elements:
- Grid layout (2 columns on phone, 3+ on tablet)
- Filter tabs at top
- Bottom sheet for file preview
- Download progress indicators

### REFACTORING NEEDED:
Break into:
1. `ResourceFilter.tsx` - Tab navigation
2. `ResourceGrid.tsx` - Grid layout container
3. `ResourceCard.tsx` - Individual file card
4. `ResourcePreviewModal.tsx` - Full-screen preview

---

# PHASE 10: BOOKING (1 Page)

## 10.1 - Booking Dashboard
**Web App Path**: `/app/athlete-dashboard/booking/page.tsx`
**Mobile Route**: `/booking`
**Priority**: 🟡 MEDIUM
**Complexity**: Medium
**Lines of Code**: ~97 lines

### Features to Replicate:
- [ ] **Athlete Selector** (for parent accounts)
  - Dropdown to select which athlete to book for

- [ ] **Calendar View**
  - Monthly calendar
  - Available session indicators
  - Tap date to see available times

- [ ] **Session List**
  - List of bookable classes/sessions
  - Time slots
  - Capacity indicators
  - Book button

- [ ] **Booking Confirmation**
  - Success modal
  - Add to calendar option

### Design Elements:
- Calendar widget with visual availability
- Session cards with time/capacity
- Confirmation animations

### Components Used:
- `MobileBookingModal`
- `ParentBookingAthleteSelector`

---

# PHASE 11: PUBLIC ASSESSMENT (1 Page - COMPLEX)

## 11.1 - Shareable Performance Assessment
**Web App Path**: `/app/(public)/assessments/[token]/page.tsx`
**Mobile Route**: `/assessments/:token`
**Priority**: 🟢 LOW (Nice to have)
**Complexity**: Very High
**Lines of Code**: ~1,066 lines

### Features to Replicate:
- [ ] **Assessment Header**
  - Athlete name
  - Organization logo
  - Assessment date
  - Share button

- [ ] **Force Profile Section**
  - Radar chart with all force metrics
  - Metric cards with percentiles
  - Color-coded performance indicators

- [ ] **Blast Motion Section**
  - Bat speed metrics
  - Attack angle charts
  - Time on plane visualization
  - Exit velocity data

- [ ] **HitTrax Section**
  - Spray chart (batted ball visualization)
  - Contact point scatter plot
  - Launch angle distribution
  - Exit velocity heat map

- [ ] **ArmCare Section**
  - Shoulder strength profile
  - Arm score
  - Recovery metrics

- [ ] **Coach Notes**
  - Text sections with recommendations
  - Performance highlights

### Design Elements:
- Premium report styling
- Print-friendly layout
- Professional charts and graphs
- Branded header/footer

### REFACTORING NEEDED:
Break into:
1. `AssessmentHeader.tsx`
2. `ForceProfileSection.tsx`
3. `BlastMotionSection.tsx`
4. `HitTraxSection.tsx`
5. `ArmCareSection.tsx`
6. `CoachNotesSection.tsx`
7. `AssessmentShareButton.tsx`

---

# 📋 MIGRATION WORKFLOW

## For Each Page, Follow This Process:

### Step 1: PRE-MIGRATION ANALYSIS
- [ ] Read the original TSX file completely
- [ ] Document all features and UI elements
- [ ] Identify all data dependencies (APIs, database queries)
- [ ] List all shared components used
- [ ] Screenshot the web app page for reference

### Step 2: REFACTORING (If Needed)
- [ ] If page is >300 lines, break into smaller components FIRST
- [ ] Create separate component files
- [ ] Test refactored web app to ensure no regressions
- [ ] Commit refactored web code

### Step 3: REACT NATIVE CONVERSION
- [ ] Create new RN component file in aspboost-mobile project
- [ ] Convert HTML elements to React Native equivalents:
  - `<div>` → `<View>`
  - `<p>`, `<span>`, `<h1>` → `<Text>`
  - `<button>` → `<TouchableOpacity>` or `<Pressable>`
  - `<input>` → `<TextInput>`
  - `<img>` → `<Image>`
  - `<a>` → `<TouchableOpacity>` with navigation

- [ ] Convert CSS/Tailwind to StyleSheet:
  - Extract all className styles
  - Create StyleSheet.create() object
  - Match exact colors, spacing, typography

- [ ] Replace web-specific libraries:
  - `recharts` → `react-native-chart-kit` or `victory-native`
  - `lucide-react` → `react-native-vector-icons`
  - `next/link` → `react-navigation`
  - `next/image` → `<Image>` with proper sizing

- [ ] Implement mobile-specific features:
  - Add KeyboardAvoidingView for forms
  - Add ScrollView/FlatList for scrollable content
  - Add SafeAreaView for notch/status bar handling
  - Add ActivityIndicator for loading states
  - Add haptic feedback where appropriate

### Step 4: STYLING PARITY
- [ ] Compare side-by-side with web app screenshots
- [ ] Match exact colors (use color tokens/constants)
- [ ] Match exact spacing and padding
- [ ] Match exact font sizes and weights
- [ ] Match exact button sizes and border radius
- [ ] Match exact icon sizes and colors
- [ ] Test on multiple screen sizes (iPhone SE, iPhone 14, iPhone 14 Pro Max)

### Step 5: FUNCTIONALITY VERIFICATION
- [ ] Test all interactive elements (buttons, inputs, toggles)
- [ ] Verify all navigation flows
- [ ] Test data fetching and display
- [ ] Verify error handling matches web app
- [ ] Test loading states
- [ ] Test empty states
- [ ] Test offline behavior (if applicable)

### Step 6: TESTING CHECKLIST
- [ ] iOS Simulator testing
- [ ] Android Emulator testing (if supporting Android)
- [ ] Real device testing
- [ ] Performance testing (smooth 60fps)
- [ ] Memory leak checks
- [ ] Accessibility testing (VoiceOver/TalkBack)

### Step 7: DOCUMENTATION
- [ ] Mark page as "COMPLETED" in this roadmap
- [ ] Document any deviations from web version (with reasons)
- [ ] Note any mobile-specific enhancements added
- [ ] Update API integration docs if needed

---

# 🎨 DESIGN SYSTEM MIGRATION

## Create Shared Design Tokens First

Before converting pages, create a centralized design system:

### `/constants/Colors.ts`
```typescript
export const Colors = {
  primary: '#3B82F6',      // Blue
  secondary: '#8B5CF6',    // Purple
  success: '#10B981',      // Green
  error: '#EF4444',        // Red
  warning: '#F59E0B',      // Amber
  text: {
    primary: '#111827',    // Gray 900
    secondary: '#6B7280',  // Gray 500
    inverse: '#FFFFFF',
  },
  background: {
    primary: '#FFFFFF',
    secondary: '#F3F4F6',  // Gray 100
    tertiary: '#E5E7EB',   // Gray 200
  },
  border: '#D1D5DB',       // Gray 300
  // Add ALL colors used in web app
};
```

### `/constants/Typography.ts`
```typescript
export const Typography = {
  sizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  weights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  families: {
    // Match web app font families
    default: 'System',
  },
};
```

### `/constants/Spacing.ts`
```typescript
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
};
```

### `/constants/Layout.ts`
```typescript
export const Layout = {
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
  shadows: {
    // React Native shadow equivalents
  },
};
```

---

# 🔧 SHARED COMPONENTS TO CREATE

Build these reusable components before page migration:

## Core UI Components
1. `<Button>` - Matches web app button styles
2. `<Input>` - Text input with labels and validation
3. `<Card>` - Container component for sections
4. `<Avatar>` - User avatar with initials fallback
5. `<Badge>` - Status badges (unread count, new, etc.)
6. `<Chip>` - Small pills for tags/categories
7. `<Divider>` - Horizontal/vertical separators
8. `<LoadingSpinner>` - Consistent loading indicator
9. `<EmptyState>` - No data placeholders
10. `<ErrorBoundary>` - Error handling wrapper

## Navigation Components
1. `<BottomTabBar>` - Main navigation (replaces FAB)
2. `<Header>` - Page headers with back button
3. `<FAB>` - Floating Action Button (if keeping from web)

## Form Components
1. `<FormInput>` - Input with validation and error display
2. `<DatePicker>` - Native date picker
3. `<Dropdown>` - Select/picker component
4. `<Checkbox>` - Checkbox with label
5. `<Switch>` - Toggle switch
6. `<Slider>` - RPE slider, etc.

## Data Display Components
1. `<MetricCard>` - Displays a metric with label and value
2. `<PercentileBar>` - Horizontal bar showing percentile
3. `<ProgressBar>` - Progress indicator
4. `<StatCard>` - Stats display card

## Media Components
1. `<VideoPlayer>` - Video playback for exercise demos
2. `<ImageViewer>` - Full-screen image viewer
3. `<FilePreview>` - Generic file preview

---

# 📦 DEPENDENCIES TO INSTALL IN REACT NATIVE

```bash
# Navigation
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
npm install react-native-screens react-native-safe-area-context

# UI Libraries
npm install react-native-vector-icons
npm install react-native-svg

# Charts (replaces recharts)
npm install victory-native
# OR
npm install react-native-chart-kit

# Forms
npm install react-hook-form

# Date/Time
npm install react-native-date-picker
# OR
npm install @react-native-community/datetimepicker

# Image Handling
npm install react-native-fast-image
npm install react-native-image-picker

# Video
npm install react-native-video

# Storage
npm install @react-native-async-storage/async-storage
# OR for sensitive data
npm install expo-secure-store

# Gestures
npm install react-native-gesture-handler
npm install react-native-reanimated

# Supabase
npm install @supabase/supabase-js

# Utilities
npm install date-fns  # Date formatting (same as web)
npm install zustand   # State management (if using)
```

---

# 🚀 RECOMMENDED MIGRATION ORDER

## Sprint 1: Core Authentication & Navigation (Week 1-2)
1. ✅ Setup design system (colors, typography, spacing)
2. ✅ Create shared UI components library
3. ✅ Sign In page (1.1)
4. ✅ Join Group page (1.2)
5. ✅ Basic navigation structure

## Sprint 2: Dashboard Foundation (Week 3-4)
6. ✅ Dashboard Home - Refactored and converted (2.1)
7. ✅ FAB Navigation component
8. ✅ Profile page (4.1)

## Sprint 3: Workout Logger (Week 5-7) - MOST CRITICAL
9. ✅ Refactor workout logger into components (web app)
10. ✅ Convert workout logger to React Native (3.1)
11. ✅ Extensive testing of workout logger

## Sprint 4: Performance Features (Week 8-9)
12. ✅ Performance dashboard (5.1)
13. ✅ Force Profile (5.2)
14. ✅ Individual test details (5.3)

## Sprint 5: Hitting & Pitching (Week 10-11)
15. ✅ Hitting performance overview (6.1)
16. ✅ Individual hitting session (6.4)
17. ✅ ArmCare dashboard (6.5)
18. ⏳ Hitting trends (6.2) - Optional
19. ⏳ Batted ball trends (6.3) - Optional

## Sprint 6: Communication & Resources (Week 12-13)
20. ✅ Messages - Refactored and converted (8.1)
21. ✅ Resources library (9.1)
22. ✅ Booking dashboard (10.1)

## Sprint 7: Additional Features (Week 14+)
23. ✅ Linked accounts (4.2) - If supporting parent accounts
24. ✅ Nutrition dashboard (7.1)
25. ✅ Update password (1.3)
26. ⏳ Public assessment (11.1) - Nice to have

---

# ✅ PROGRESS TRACKER

## Legend
- ⬜ Not started
- 🟡 Refactoring in progress (web app)
- 🔵 Converting to React Native
- ✅ Completed and tested
- ⏳ Skipped/Optional

---

## Phase 1: Authentication
- ⬜ 1.1 Sign In
- ⬜ 1.2 Join Group
- ⬜ 1.3 Update Password
- ⏳ 1.4 Sign Up (Facility Owner) - SKIP FOR NOW

## Phase 2: Dashboard
- ⬜ 2.1 Dashboard Home

## Phase 3: Workouts
- ⬜ 3.1 Workout Logger (**HIGHEST PRIORITY**)

## Phase 4: Profile
- ⬜ 4.1 Profile
- ⬜ 4.2 Linked Accounts

## Phase 5: Performance
- ⬜ 5.1 Performance Dashboard
- ⬜ 5.2 Force Profile
- ⬜ 5.3 Test Details

## Phase 6: Hitting & Pitching
- ⬜ 6.1 Hitting Overview
- ⬜ 6.2 Hitting Trends
- ⬜ 6.3 Batted Ball Trends
- ⬜ 6.4 Hitting Session
- ✅ 6.5 ArmCare

## Phase 7: Nutrition
- ⬜ 7.1 Nutrition Dashboard

## Phase 8: Communication
- ⬜ 8.1 Messages

## Phase 9: Resources
- ⬜ 9.1 Resources Library

## Phase 10: Booking
- ⬜ 10.1 Booking Dashboard

## Phase 11: Public
- ⬜ 11.1 Assessment Report

---

# 🎯 CRITICAL SUCCESS FACTORS

1. **Visual Parity is Non-Negotiable**
   - Users should not notice any visual differences
   - Colors, spacing, fonts must match exactly
   - Animations and transitions should feel native to mobile

2. **Performance is Key**
   - 60fps scrolling and animations
   - Fast data loading with proper caching
   - Optimized images and assets

3. **Refactor First, Then Convert**
   - Large web components MUST be broken down before conversion
   - Smaller components are easier to convert and maintain
   - Refactored web code improves web app too

4. **Test Thoroughly**
   - Each page must be tested on real devices
   - Test all user flows end-to-end
   - Performance profiling for each page

5. **Maintain Feature Parity**
   - Every feature in web app must work in mobile
   - Error handling must be identical
   - Offline behavior should gracefully degrade

---

# 📝 NOTES FOR MIGRATION

## Important Considerations:

### Authentication Flow
- Use secure token storage (SecureStore on iOS)
- Implement biometric authentication (Face ID/Touch ID)
- Handle session expiration gracefully

### Data Fetching
- Use React Query or SWR for caching
- Implement pull-to-refresh on all list views
- Show skeleton loaders during fetch

### Navigation
- Use React Navigation v6+
- Implement deep linking for notifications
- Handle back navigation properly

### Push Notifications
- Set up Firebase Cloud Messaging
- Notify athletes of new messages
- Notify of upcoming workouts
- Notify of new assignments

### Offline Support
- Cache workout data locally
- Allow workout logging offline
- Sync when connection restored

### Analytics
- Track screen views
- Track user interactions
- Monitor performance metrics

---

# 🆘 WHEN YOU'RE READY TO START

## Tell Me:
1. **Which page you want to convert** (use the number, e.g., "1.1 Sign In")
2. **I will:**
   - Read the original TSX file
   - Refactor it if needed (large components)
   - Create the React Native equivalent
   - Ensure exact visual parity
   - Provide you with the complete code

## Example Command:
> "Convert page 1.1 - Sign In to React Native"

OR

> "Start with Phase 1 - convert all authentication pages"

OR

> "I want to start with the workout logger (3.1) - refactor and convert it"

---

# ⚠️ FINAL REMINDERS

1. **This roadmap does NOT modify your web app** - it's just documentation
2. **Each conversion is a separate task** - we'll do one page at a time
3. **You can start with any page** - though the recommended order is above
4. **I will ensure exact visual matching** - you won't have to worry about styling
5. **All functionality will be preserved** - same features, just mobile-native

---

**Total Estimated Timeline**: 14-16 weeks for complete migration
**Core Features Timeline**: 7-9 weeks (Sprints 1-3)

Ready to begin! Just tell me which page to start with. 🚀
