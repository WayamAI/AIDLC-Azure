import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Zap, ArrowRight, TestTubes, Brain, BarChart3, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND_NAME, LOGO_SRC } from "@/lib/brand";

const features = [
  { icon: Brain, title: "Intelligent Requirement Analysis", desc: "Requirements are automatically transformed into structured, comprehensive test suites with full scenario coverage." },
  { icon: TestTubes, title: "Synthetic Data Generation", desc: "AI-driven generation of realistic test datasets including telemetry, GPS coordinates, and sensor readings tailored to your specifications." },
  { icon: BarChart3, title: "Risk-Based Prioritization", desc: "Test cases are dynamically ranked by failure history and impact severity, ensuring critical issues are addressed first." },
  { icon: Shield, title: "Regression & Stability Tracking", desc: "Known failures are continuously identified and monitored, enabling teams to track test stability across release cycles." },
];

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-hero overflow-hidden">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 relative z-10">
        <div className="flex items-center gap-3">
          <img src={LOGO_SRC} alt={BRAND_NAME} className="h-9 w-auto max-w-[160px] object-contain" />
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="border-border/50 text-foreground hover:bg-muted/50"
            onClick={() => navigate("/dashboard")}
          >
            Dashboard
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative flex flex-col items-center justify-center min-h-[85vh] px-6 text-center">
        {/* Background orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-secondary/5 rounded-full blur-3xl animate-float" style={{ animationDelay: "1.5s" }} />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative z-10 max-w-4xl"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm mb-8">
            <Zap className="h-3.5 w-3.5" />
            <span>Enterprise AI-Driven Test Intelligence</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-display font-bold leading-tight mb-6">
            <span className="text-gradient-brand">{BRAND_NAME}</span>
            <br />
            Intelligent Test Generation
            <br />
            &amp; Optimization
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Accelerate quality assurance with AI-powered test generation. Submit a requirement, receive a complete test suite, execute with one click, and obtain a risk-based priority ranking end to end.
          </p>

          <div className="flex items-center gap-4 justify-center mb-10">
            {/* <Button
              size="lg"
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-display font-semibold px-8 h-12 text-base"
              onClick={() => navigate("/requirements")}
            >
              Get Started Submit Requirement
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button> */}
            <Button
              size="lg"
              variant="outline"
              className="border-border/50 text-foreground hover:bg-muted/50 font-display h-12 px-8 text-base"
              onClick={() => navigate("/dashboard")}
            >
              View Intelligence Dashboard
            </Button>
          </div>

          {/* 4-step flow strip */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap justify-center">
            {["1. Submit Requirement", "2. Review Test Suite", "3. Execute Tests", "4. Prioritize by Risk"].map((step, i, arr) => (
              <Fragment key={step}>
                <span className="px-3 py-1 rounded-full border border-border/40 bg-muted/20">{step}</span>
                {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
              </Fragment>
            ))}
          </div>
        </motion.div>

        {/* Neon line */}
        <div className="neon-line w-full max-w-xl mt-20" />

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mt-16 max-w-6xl w-full"
        >
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 + i * 0.1 }}
              className="floating-card p-6 text-left"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-sm mb-2">{f.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
};

export default Landing;
