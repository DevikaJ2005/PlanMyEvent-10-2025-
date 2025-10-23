// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'planMyEventSecret',
  resave: false,
  saveUninitialized: true
}));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB at', process.env.MONGO_URI || 'localhost:27017'))
.catch(err => console.error('MongoDB connection error:', err));

// Schemas & Models
const registrationSchema = new mongoose.Schema({
  eventName: String,
  studentName: String,
  email: String,
  college: String,
  year: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Registration = mongoose.model('Registration', registrationSchema);

const eventSchema = new mongoose.Schema({
  eventName: String,
  date: String,
  time: String,
  venue: String,
  description: String,
  checklist: [String],
  createdBy: mongoose.Schema.Types.ObjectId,
  approved: { type: Boolean, default: false },
  rejected: { type: Boolean, default: false }, // 👈 ADD THIS
  createdAt: { type: Date, default: Date.now }
});

const Event = mongoose.model('Event', eventSchema);

const contactSchema = new mongoose.Schema({
  name: String,
  email: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isFounder) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
}

// -------- ROUTES -------- //

// Registration API
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/register', async (req, res) => {
  try {
    if (!req.session || !req.session.email) {
      return res.status(401).send('Please log in to register');
    }

    const { eventName, studentName, college, year, message } = req.body;
    const email = req.session.email; // ✅ Use session email

    const duplicate = await Registration.findOne({ eventName, email });
    if (duplicate) return res.status(409).send("You have already registered for this event.");

    await Registration.create({ eventName, studentName, email, college, year, message });
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).send('Registration failed');
  }
});


// Signup API
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).send('Email already registered');

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hashedPassword });
    res.sendFile(path.join(__dirname, 'public', 'success-signup.html'));
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('Signup failed');
  }
});

// Login API
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false });
    }

    req.session.userId = user._id;
    req.session.email = user.email;
    // Founder/admin check - change email as needed
    req.session.isFounder = (user.email === "planmyevent@gmail.com");

    res.json({ success: true, isFounder: req.session.isFounder });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false });
  }
});

// Logout API
app.get('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// Current user info
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ loggedIn: false });
  const user = await User.findById(req.session.userId).select('name email');
  res.json({ loggedIn: true, user });
});

// Duplicate registration check
app.get('/api/check-duplicate', async (req, res) => {
  try {
    const { event, email } = req.query;
    if (!event || !email) return res.status(400).json({ exists: false, message: "Event and email required" });

    const existing = await Registration.findOne({ eventName: event, email });
    res.json({ exists: !!existing });
  } catch (err) {
    console.error('Check duplicate error:', err);
    res.status(500).json({ exists: false });
  }
});

// Create Event API (creates as pending: approved = false)
app.post('/api/events', async (req, res) => {
  try {
    const { eventName, date, time, venue, description, 'sustainability[]': sustainability } = req.body;
    const existingEvent = await Event.findOne({ eventName, date, venue });
    if (existingEvent) return res.status(409).json({ success: false, message: 'Event already exists' });

    const ev = await Event.create({
      eventName,
      date,
      time,
      venue,
      description,
      checklist: sustainability || [],
      createdBy: req.session.userId || null,
      approved: false
    });

    res.json({ success: true, eventId: ev._id });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ success: false });
  }
});

// Duplicate Event Check API (used by your create.html)
app.post('/api/events/check-duplicate', async (req, res) => {
  try {
    const { eventName, date, venue } = req.body;
    const existingEvent = await Event.findOne({ eventName, date, venue });
    res.json({ exists: !!existingEvent });
  } catch (err) {
    console.error('Duplicate event check error:', err);
    res.status(500).json({ exists: false });
  }
});

// ADMIN: Get all approved events
app.get('/api/events/approved/admin', requireAdmin, async (req, res) => {
  try {
    const approved = await Event.find({ approved: true }).sort({ createdAt: -1 });
    res.json(approved);
  } catch (err) {
    console.error('Fetch all approved events error:', err);
    res.status(500).send('Failed to fetch approved events');
  }
});

// CREATOR: Get rejected events created by them
app.get('/api/events/rejected', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
    }

    const rejectedEvents = await Event.find({
      rejected: true,
      createdBy: req.session.userId
    }).sort({ createdAt: -1 });

    res.json(rejectedEvents);
  } catch (err) {
    console.error('Fetch creator rejected events error:', err);
    res.status(500).send('Failed to fetch rejected events');
  }
});




// Convenience: GET /api/events returns approved events (excluded registrations for same email)
app.get('/api/events', async (req, res) => {
  try {
    const email = req.query.email;
    let registeredEvents = [];
    if (email) {
      const regs = await Registration.find({ email }).select('eventName');
      registeredEvents = regs.map(r => r.eventName);
    }

    const events = await Event.find({
      approved: true,
      eventName: { $nin: registeredEvents }
    }).sort({ date: 1 });

    res.json(events);
  } catch (err) {
    console.error('Fetch events error:', err);
    res.status(500).send('Failed to fetch events');
  }
});

// ADMIN: Get pending events (approved === false)
app.get('/api/events/pending', requireAdmin, async (req, res) => {
  try {
    const pending = await Event.find({ approved: false }).sort({ createdAt: -1 });
    res.json(pending);
  } catch (err) {
    console.error('Fetch pending events error:', err);
    res.status(500).send('Failed to fetch pending events');
  }
});
// CREATOR: Get pending events created by logged-in user
app.get('/api/events/pending/creator', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
    }

    const pendingEvents = await Event.find({
      approved: false,
      createdBy: req.session.userId
    }).sort({ createdAt: -1 });

    res.json(pendingEvents);
  } catch (err) {
    console.error('Fetch creator pending events error:', err);
    res.status(500).send('Failed to fetch pending events');
  }
});
// CREATOR: Get pending events created by logged-in user
app.get('/api/events/pending/creator', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
    }

    const pendingEvents = await Event.find({
      approved: false,
      createdBy: req.session.userId
    }).sort({ createdAt: -1 });

    res.json(pendingEvents);
  } catch (err) {
    console.error('Fetch creator pending events error:', err);
    res.status(500).send('Failed to fetch pending events');
  }
});

// CREATOR: Get approved events created by logged-in user
app.get('/api/events/approved/creator', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
    }

    const approvedEvents = await Event.find({
      approved: true,
      createdBy: req.session.userId
    }).sort({ createdAt: -1 });

    res.json(approvedEvents);
  } catch (err) {
    console.error('Fetch creator approved events error:', err);
    res.status(500).send('Failed to fetch approved events');
  }
});

// ADMIN: Approve event
app.post('/api/events/approve/:id', requireAdmin, async (req, res) => {
  try {
    const eventId = req.params.id;
    const updatedEvent = await Event.findByIdAndUpdate(eventId, { approved: true }, { new: true });
    if (!updatedEvent) return res.status(404).json({ success: false, message: 'Event not found.' });
    res.json({ success: true, message: 'Event approved.', event: updatedEvent });
  } catch (err) {
    console.error('Approve event error:', err);
    res.status(500).json({ success: false, message: 'Approval failed.' });
  }
});

// ADMIN: Reject event (mark as rejected instead of deleting)
app.post('/api/events/reject/:id', requireAdmin, async (req, res) => {
  try {
    const eventId = req.params.id;
    const updated = await Event.findByIdAndUpdate(
      eventId,
      { approved: false, rejected: true }, // mark rejected
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Event not found.' });
    res.json({ success: true, message: 'Event rejected.', event: updated });
  } catch (err) {
    console.error('Reject event error:', err);
    res.status(500).json({ success: false, message: 'Reject failed.' });
  }
});


// Get events created by logged-in user
app.get('/api/events/created', async (req, res) => {
  try {
    if (!req.session.userId) return res.status(403).json([]);
    const events = await Event.find({ createdBy: req.session.userId }).sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    console.error('Fetch created events error:', err);
    res.status(500).json([]);
  }
});

// Get registrations for events created by the logged-in user
app.get('/api/registrations/by-creator', async (req, res) => {
  try {
    if (!req.session.userId) return res.status(403).json([]);
    const creatorEvents = await Event.find({ createdBy: req.session.userId }).select('eventName');
    const eventNames = creatorEvents.map(ev => ev.eventName);
    const registrations = await Registration.find({ eventName: { $in: eventNames } }).sort({ createdAt: -1 });
    res.json(registrations);
  } catch (err) {
    console.error('Fetch creator registrations error:', err);
    res.status(500).json([]);
  }
});

// Get all registrations (admin/general)
app.get('/api/registrations', async (req, res) => {
  try {
    const registrations = await Registration.find().sort({ createdAt: -1 });
    res.json(registrations);
  } catch (err) {
    console.error('Fetch registrations error:', err);
    res.status(500).json([]);
  }
});
// ----------------- PARTICIPANT: get my registrations with event details -----------------
// ----------------- PARTICIPANT: get my registrations with event details -----------------
app.get('/api/my-registrations', async (req, res) => {
  try {
    if (!req.session || !req.session.email) {
      return res.status(401).json({ success: false, message: 'Not logged in' });
    }

    const email = req.session.email;

    // Get all registrations for this user
    const regs = await Registration.find({ email }).sort({ createdAt: -1 });
    const eventNames = regs.map(r => r.eventName);

    // Get all matching events in one query
    const events = await Event.find({ eventName: { $in: eventNames } });

    const results = regs.map(r => ({
      registration: r,
      event: events.find(e => e.eventName === r.eventName) || null
    }));

    res.json(results);
  } catch (err) {
    console.error('Fetch my registrations error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch registrations' });
  }
});



// ----------------- PARTICIPANT: unregister (delete registration) -----------------
app.post('/api/unregister/:registrationId', async (req, res) => {
  try {
    if (!req.session || !req.session.email) {
      return res.status(401).json({ success: false, message: 'Not logged in' });
    }

    const regId = req.params.registrationId;
    const reg = await Registration.findById(regId);
    if (!reg) return res.status(404).json({ success: false, message: 'Registration not found' });

    // only allow the owner (by email) to delete their registration
    if (reg.email !== req.session.email) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    await Registration.findByIdAndDelete(regId);
    res.json({ success: true, message: 'Unregistered successfully' });
  } catch (err) {
    console.error('Unregister error:', err);
    res.status(500).json({ success: false, message: 'Failed to unregister' });
  }
});
// ----------------- USER INFO (for logged-in participant) -----------------
app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.email) {
    return res.status(401).json({ success: false, message: 'Not logged in' });
  }
  res.json({ success: true, email: req.session.email });
});



// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});