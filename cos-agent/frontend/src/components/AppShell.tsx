import { Outlet, useLocation } from "react-router-dom";
import { IconRail } from "./IconRail.tsx";

const FULL_HEIGHT_ROUTES = ["/chat"];

export function AppShell() {
  const location = useLocation();
  const isFullHeight = FULL_HEIGHT_ROUTES.some((p) =>
    location.pathname === p || location.pathname.startsWith(`${p}/`)
  );

  return (
    <div className="co-app-shell" data-testid="app-shell">
      <IconRail />
      <main
        className={isFullHeight ? "co-app-main co-app-main--flush" : "co-app-main"}
      >
        <div
          className={isFullHeight ? "co-app-main-inner--fill" : "co-scroll-pane"}
          style={isFullHeight ? undefined : { height: "100%" }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
