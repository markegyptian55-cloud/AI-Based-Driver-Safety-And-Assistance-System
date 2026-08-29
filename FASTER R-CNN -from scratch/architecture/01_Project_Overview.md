> **Important for AI Assistants (Claude/ChatGPT):**
>
> This document is part of the official software specification for the AI-Based Driver Drowsiness Detection System.
>
> Any generated code must follow this specification.
>
> Do not redesign the architecture unless explicitly requested.
> Prefer extending existing modules over replacing them.
> Maintain consistency across all documents in the `architecture/` folder.



# AI-Based Driver Drowsiness Detection System
## Project Overview

**Version:** 1.0

**Document Type:** Software Design Document (SDD)

**Project Status:** Development

**Author:** Michael Magdy & Team

**Last Updated:** July 2026

---

# 1. Project Title

AI-Based Driver Drowsiness Detection System

---

# 2. Project Vision

The vision of this project is to develop a professional AI-powered Driver Monitoring System (DMS) that detects driver fatigue, drowsiness, and yawning in real time using computer vision and deep learning.

The system aims to reduce road accidents caused by driver fatigue by providing timely alerts and actionable insights while maintaining a modern, scalable, and production-ready software architecture.

This project is designed as a complete software product rather than only an AI model.

---

# 3. Problem Statement

Driver fatigue is one of the leading causes of traffic accidents worldwide.

Many accidents occur because drivers:

- Close their eyes for prolonged periods.
- Frequently yawn.
- Lose attention to the road.
- Continue driving while sleepy.

Traditional monitoring methods rely on human observation or expensive hardware.

Recent advances in Artificial Intelligence and Computer Vision make it possible to monitor drivers using only a standard camera.

This project provides a software-based solution that performs real-time monitoring using AI.

---

# 4. Project Objectives

The primary objectives of this project are:

- Detect driver drowsiness in real time.
- Detect prolonged eye closure.
- Detect yawning.
- Analyze head pose.
- Monitor driver attention.
- Generate fatigue scores.
- Alert drivers before dangerous situations occur.
- Store monitoring history.
- Generate analytical reports.
- Build a professional web application for monitoring and management.
- Demonstrate software engineering best practices in addition to AI engineering.

---

# 5. Project Scope

The system includes:

## AI Detection

- Face Detection
- Eye Detection
- Mouth Detection
- Head Pose Estimation
- Driver State Classification

## Driver States

- Normal
- Yawning
- Drowsy
- Sleeping

## Monitoring

- Live Webcam
- Dashcam
- Uploaded Images
- Uploaded Videos

## Alerts

- Sound Alarm
- Email Notification
- WhatsApp Notification
- Dashboard Alerts

## Analytics

- Detection History
- Statistics
- Reports
- Explainable AI Dashboard

## Administration

- User Management
- System Settings
- AI Configuration
- Reports Management
- Monitoring Sessions

---

# 6. Target Users

The platform is designed for:

## Primary Users

Drivers

Fleet Operators

Transportation Companies

Research Institutions

Universities

---

## Secondary Users

Administrators

Project Supervisors

Consultants

AI Researchers

Software Developers

---

# 7. User Roles

The application supports multiple user roles.

## Guest

Can:

- View landing page
- Try demo mode
- Explore limited features

Cannot:

- Save history
- Access reports
- Change settings

---

## Registered User

Can:

- Login
- Monitor using webcam
- Analyze images
- Analyze videos
- View history
- Generate reports
- Configure notifications

---

## Administrator

Can:

- Manage users
- Configure AI settings
- View system health
- Manage reports
- Manage storage
- Manage models
- View logs
- Access analytics

---

# 8. Functional Requirements

The system shall provide:

## Authentication

- Login
- Logout
- Session Management

---

## Live Monitoring

- Webcam Monitoring
- Dashcam Monitoring
- Real-time AI Inference

---

## Image Analysis

Upload an image and analyze driver status.

---

## Video Analysis

Upload a video and analyze the complete timeline.

---

## Driver Detection

Detect:

- Face
- Eyes
- Mouth

---

## Fatigue Detection

Calculate:

- EAR (Eye Aspect Ratio)
- MAR (Mouth Aspect Ratio)
- Head Pose
- Fatigue Score

---

## Alerts

Generate alerts when:

- Eyes remain closed beyond threshold.
- Driver yawns repeatedly.
- Driver enters sleeping state.

---

## Reports

Generate reports including:

- Session Summary
- Detection Timeline
- Statistics
- AI Decisions

---

## History

Store:

- Monitoring Sessions
- Alerts
- Reports
- Uploaded Media

---

## Administration

Provide complete administrative control.

---

# 9. Non-Functional Requirements

The system should satisfy:

## Performance

- Real-time inference
- Low latency
- Efficient GPU utilization

---

## Scalability

Support future AI models.

Support increasing numbers of users.

---

## Maintainability

Use modular architecture.

Separate:

- Frontend
- Backend
- AI Engine
- Database

---

## Security

- Authentication
- Authorization
- Secure APIs
- JWT
- HTTPS

---

## Reliability

Graceful error handling.

Automatic recovery where possible.

---

## Usability

Simple interface.

Professional design.

Responsive layouts.

---

# 10. AI Technologies

The project uses Artificial Intelligence for:

- Object Detection
- Face Detection
- Eye Detection
- Mouth Detection
- Head Pose Analysis
- Temporal Fatigue Analysis

Current supported model:

- YOLO (best.pt)

Future planned models:

- RF-DETR

- Faster R-CNN

---

# 11. Technology Stack

## Frontend

- React
- TypeScript
- TailwindCSS
- shadcn/ui
- Framer Motion

---

## Backend

- FastAPI
- Python

---

## AI

- PyTorch
- Ultralytics YOLO
- OpenCV

---

## Database

- Supabase PostgreSQL

---

## Storage

- Supabase Storage

---

## Authentication

- Supabase Authentication
- JWT

---

## Communication

- REST API

- WebSocket

---

## Deployment

Planned:

- Render

or

- Fly.io

Database:

- Supabase

Frontend:

- Lovable Export

---

# 12. High-Level Workflow

Driver

↓

Camera

↓

Frontend (Lovable)

↓

FastAPI Backend

↓

AI Inference Engine

↓

Fatigue Analysis

↓

Alert Decision Engine

↓

Database

↓

Dashboard

↓

Reports

↓

Notifications

---

# 13. Expected Features

The final product includes:

- Landing Page

- Authentication

- Dashboard

- Live Monitoring

- Video Analysis

- Image Analysis

- Detection History

- Analytics Dashboard

- Reports Center

- Alert Center

- Settings Center

- User Profile

- Administrator Panel

- AI Explainability Dashboard

- About Project

- Error & Maintenance Pages

---

# 14. Success Criteria

The project is considered successful if it:

- Successfully detects driver states.

- Produces accurate fatigue alerts.

- Performs real-time inference.

- Supports image and video analysis.

- Provides explainable AI outputs.

- Stores monitoring history.

- Generates professional reports.

- Supports administrator management.

- Is deployable to the cloud.

- Demonstrates professional software engineering practices.

---

# 15. Future Enhancements

Potential future improvements include:

- Mobile Application

- Fleet Management Dashboard

- Multi-Camera Support

- Voice Assistant

- Cloud AI Inference

- Edge Device Deployment

- Driver Identification

- Face Recognition

- Emotion Recognition

- Driver Distraction Detection

- GPS Integration

- Vehicle Telemetry Integration

- AI Model Auto-Update

- Explainable AI Improvements

- Advanced Analytics

---

# 16. Development Status

| Phase | Status |
|---------|--------|
| Project Planning | ✅ Completed |
| Dataset Preparation | ✅ Completed |
| AI Model Training | ✅ Completed |
| Model Evaluation | ✅ Completed |
| Frontend Design | ✅ Completed |
| Backend Development | 🔄 In Progress |
| Frontend Integration | ⏳ Planned |
| Testing | ⏳ Planned |
| Deployment | ⏳ Planned |
| Final Presentation | ⏳ Planned |

---

# 17. Document Purpose

This document serves as the primary reference for all future development.

All backend implementation, frontend integration, AI modules, APIs, database design, and deployment decisions should remain consistent with the vision, objectives, and requirements described in this document.