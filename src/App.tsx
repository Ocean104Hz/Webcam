import { Routes, Route } from "react-router-dom";
import Mobile from "./pages/Mobile";
import Sheet from "./pages/Sheet";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Mobile />} />
      <Route path="/Sheet" element={<Sheet />} />
    </Routes>
  );
}

export default App;
