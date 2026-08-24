import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Requirements from "./pages/Requirements";
import SyntheticData from "./pages/SyntheticData";
import TestExecution from "./pages/TestExecution";
import Prioritization from "./pages/Prioritization";
import LiveTestRunner from "./pages/LiveTestRunner";
import CodeReview from "./pages/CodeReview";
import CIIntelligence from "./pages/CIIntelligence";
import DefectPrediction from "./pages/DefectPrediction";
import GeneratedTests from "./pages/GeneratedTests";
import Incidents from "./pages/Incidents";
import Monitoring from "./pages/Monitoring";
import ReleaseGate from "./pages/ReleaseGate";
import RequirementsIntelligence from "./pages/RequirementsIntelligence";
import SprintIntelligence from "./pages/SprintIntelligence";
import Workspace from "./pages/Workspace";
import SDLCPipeline from "./pages/SDLCPipeline";
import CodeImpact from "./pages/CodeImpact";
import DocTests from "./pages/DocTests";
import PRDGenerator from "./pages/PRDGenerator";
import NotFound from "./pages/NotFound";
import DashboardLayout from "@/components/DashboardLayout";
import UserProfile from "./pages/UserProfile";
import Deployments from "./pages/Deployments";
import ApiCosts from "./pages/ApiCosts";
import AiIde from "./pages/AiIde";
import RepoBaseline from "./pages/RepoBaseline";
import RootCauseAnalysis from "@/pages/RootCauseAnalysis";
import RootCauseDetail from "@/pages/RootCauseDetail";
import TestSelection from "@/pages/TestSelection";
import SelfHealingTests from "@/pages/SelfHealingTests";
import ConnectorsSettings from "@/pages/ConnectorsSettings";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";

function RootRedirect() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page text-sm text-[var(--color-tertiary)]">
        Checking session…
      </div>
    );
  }
  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
}

function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route path="/v1" element={<Navigate to="/" replace />} />
        <Route path="/v1/*" element={<Navigate to="/" replace />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/requirements" element={<Requirements />} />
            <Route path="/synthetic-data" element={<SyntheticData />} />
            <Route path="/test-execution" element={<TestExecution />} />
            <Route path="/prioritization" element={<Prioritization />} />
            <Route path="/live-testing" element={<LiveTestRunner />} />
            <Route path="/live-test-runner" element={<LiveTestRunner />} />
            <Route path="/code-review" element={<CodeReview />} />
            <Route path="/ci-intelligence" element={<CIIntelligence />} />
            <Route path="/defect-prediction" element={<DefectPrediction />} />
            <Route path="/generated-tests" element={<GeneratedTests />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/release-gate" element={<ReleaseGate />} />
            <Route path="/requirements-intelligence" element={<RequirementsIntelligence />} />
            <Route path="/sprint-intelligence" element={<SprintIntelligence />} />
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/pipeline" element={<SDLCPipeline />} />
            <Route path="/deployments" element={<Deployments />} />
            <Route path="/code-impact" element={<CodeImpact />} />
            <Route path="/doc-tests" element={<DocTests />} />
            <Route path="/prd" element={<PRDGenerator />} />
            <Route path="/profile" element={<UserProfile />} />
            <Route path="/settings/connectors" element={<ConnectorsSettings />} />
            <Route path="/cost-tracker" element={<ApiCosts />} />
            <Route path="/ai-ide" element={<AiIde />} />
            <Route path="/repo-baseline" element={<RepoBaseline />} />
            <Route path="/root-cause" element={<RootCauseAnalysis />} />
            <Route path="/root-cause/:id" element={<RootCauseDetail />} />
            <Route path="/test-selection" element={<TestSelection />} />
            <Route path="/self-healing" element={<SelfHealingTests />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
