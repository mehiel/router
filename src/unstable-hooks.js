/* eslint-disable jsx-a11y/anchor-has-content */
import React, {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import PropTypes from "prop-types";
import { pick, match, resolve, startsWith, makeCancelable } from "./lib/utils";
import { globalHistory } from "./lib/history";

// TODO: use scheduler
var rIC = window.requestIdleCallback || (cb => Promise.resolve().then(cb));

////////////////////////////////////////////////////////////////////////////////
// Contexts
const HistoryContext = createContext(globalHistory);
const MatchContext = createContext({ route: { path: "" }, uri: "" });

////////////////////////////////////////////////////////////////////////////////
// helpers
const shouldNavigate = event => {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
  );
};

const getBasePath = path =>
  path === "/" ? path : stripSlashes(path.replace(/\*$/, ""));

const createRoutes = (config, basepath) =>
  Object.keys(config).map(path => {
    const fullPath =
      path === "."
        ? basepath
        : stripSlashes(basepath) + "/" + stripSlashes(path);
    return {
      path: fullPath,
      handler: config[path]
    };
  });

const stripSlashes = str => str.replace(/(^\/+|\/+$)/g, "");

////////////////////////////////////////////////////////////////////////////////
// hooks
function useLocation() {
  const history = useContext(HistoryContext);
  const [location, setLocation] = useState(globalHistory.location);

  useEffect(
    () =>
      history.listen(() => {
        rIC(() => setLocation(history.location));
      }),
    [history]
  );

  useEffect(history._onTransitionComplete, [location]);

  return [location, history.navigate];
}

function useRouter(routeConfig, _default) {
  const [location, navigate] = useLocation();
  const base = useContext(MatchContext);
  const basepath = getBasePath(base.route.path);

  const routes = useMemo(() => createRoutes(routeConfig, basepath), [
    routeConfig,
    basepath
  ]);

  const match = useMemo(() => pick(routes, location.pathname), [
    location.pathname,
    routes
  ]);

  if (match) {
    const { params, uri, route } = match;

    const element = route.handler({
      ...params,
      uri: uri,
      navigate: navigate,
      location: location
    });
    return React.createElement(MatchContext.Provider, {
      value: match,
      children: element
    });
  } else {
    return (_default && _default()) || "Not Found";
  }
}

function useMatch(path) {
  const [location, navigate] = useLocation();
  const result = match(path, location.pathname);
  return { navigate, ...result };
}

////////////////////////////////////////////////////////////////////////////////
// Components
function Link(_ref) {
  const { to, state, replace = false, ...anchorProps } = _ref;
  const [location, navigate] = useLocation();

  const base = useContext(MatchContext);
  const href = resolve(to, base.uri);
  const isCurrent = location.pathname === href;

  return (
    <a
      aria-current={isCurrent ? "page" : undefined}
      {...anchorProps}
      href={href}
      onClick={event => {
        if (anchorProps.onClick) anchorProps.onClick(event);
        if (shouldNavigate(event)) {
          event.preventDefault();
          navigate(href, { state, replace });
        }
      }}
    />
  );
}

const k = () => {};

function LinkNav(_ref) {
  const _navigationCancelablePromise = useRef(null);
  const [navigating, setNavigating] = useState(false);
  const [location, navigate] = useLocation();
  const base = useContext(MatchContext);

  const {
    to,
    state,
    replace = false,
    getProps = k,
    onClick,
    children,
    ...anchorProps
  } = _ref;

  const href = resolve(to, base.uri);
  const isCurrent = location.pathname === href;
  const isPartiallyCurrent = startsWith(location.pathname, href);

  const stopNavigation = useCallback(
    canceled => !canceled && setNavigating(false),
    []
  );

  const _onClick = useCallback(
    event => {
      if (onClick) onClick(event);
      if (shouldNavigate(event)) {
        event.preventDefault();
        // set current link state as navigating
        setNavigating(true);

        // create a cancelable promise out of navigate
        // we need to be able to cancel on willUnmount to
        // avoid setting state on an unmounted component
        const cp = makeCancelable(navigate(href, { state, replace }));

        // set promise handlers after creation in order to be queued
        // after cancelation handlers
        cp.promise
          .then(() => stopNavigation())
          .catch(e => stopNavigation(Boolean(e && e.isCanceled)));

        // attach cancelable promise to the component instance
        // to be able to reference and cancel it from componentWillUnmount
        _navigationCancelablePromise.current = cp;
      }
    },
    [href, state, replace, onClick]
  );

  useEffect(
    () => () => {
      const ncp = _navigationCancelablePromise.current;
      if (ncp) ncp.cancel();
    },
    []
  );

  return (
    <a
      aria-current={isCurrent ? "page" : undefined}
      {...anchorProps}
      {...getProps({
        isCurrent,
        isPartiallyCurrent,
        href,
        location,
        navigating
      })}
      href={href}
      onClick={_onClick}
    >
      {typeof children === "function" ? children(navigating) : children}
    </a>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Redirects
function RedirectRequest(uri) {
  this.uri = uri;
}

const isRedirect = o => o instanceof RedirectRequest;

const redirectTo = to => {
  throw new RedirectRequest(to);
};

class RedirectBoundary extends Component {
  static contextType = HistoryContext;
  static propTypes = {
    children: PropTypes.node.isRequired
  };

  componentDidCatch(error, info) {
    if (isRedirect(error)) {
      const history = this.context;
      history.navigate(error.uri, { replace: true });
    } else {
      throw error;
    }
  }

  render() {
    return this.props.children;
  }
}

export {
  useRouter,
  useLocation,
  useMatch,
  Link,
  LinkNav
  // NOT YET READY TO GET EXPORTED
  // RedirectBoundary,
  // isRedirect,
  // redirectTo
};
