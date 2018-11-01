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
function useRouter(routeConfig, _default) {
  const { location, navigate } = useContext(HistoryContext);
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
  const { location, navigate } = useContext(HistoryContext);
  const result = match(path, location.pathname);
  return { navigate, ...result };
}

function useLocation() {
  const { location, navigate } = useContext(HistoryContext);
  return [location, navigate];
}

////////////////////////////////////////////////////////////////////////////////
// Components
function Link(_ref) {
  const { to, state, replace = false, ...anchorProps } = _ref;
  const { location, navigate } = useContext(HistoryContext);

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
  const { location, navigate } = useContext(HistoryContext);
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
// LocationProvider

// Even though not desirable we need to provide an element to be used somewhere
// on the top of the tree above routers and redirects. It will handle history
// and listening / unlistening before any navigation happens. It will also handle
// redirections. UX wise redirections are better when they throw and suspend the
// rendering process as the use doesn't see cluttered UIs for fractions of a second.
class LocationProvider extends Component {
  static propTypes = {
    history: PropTypes.object.isRequired,
    children: PropTypes.any.isRequired
  };

  static defaultProps = {
    history: globalHistory
  };

  static refs = {};

  constructor(props) {
    super(props);
    this.unmounted = false;
    this.state = { context: this.getContext(props) };

    const history = props.history;

    // In order to be able to properly use history we need to setup our listener
    // before any of our children is rendered and be able to use the context to
    // navigate or redirect as part of the rendering phase. Having a single listener
    // that sets the context is key for stable behavior, performance and avoidance
    // of any memory leaks.
    //
    // (eg when trying to render a page that I don't have permissions it will
    // redirect me to a /login url)
    //
    // BUT constructor is part of the rendering phase and any kind of suspension
    // or concurrent rendering may throw it out and re-try in the future. So
    // side-effects need extra care in here. For that case and to avoid multiple
    // listeners we keep refs as a static class property than we can mutate and
    // reference in subsequent calls of the constructor in order to remove previous
    // listeners.
    if (LocationProvider.refs.unlisten) LocationProvider.refs.unlisten();
    LocationProvider.refs.unlisten = history.listen(() => {
      rIC(() => {
        rIC(() => {
          if (!this.unmounted) {
            this.setState(() => ({ context: this.getContext() }));
          }
        });
      });
    });
  }

  getContext(props) {
    props = props || this.props;
    const { navigate, location } = props.history;
    return { navigate, location };
  }

  componentDidCatch(error, info) {
    if (isRedirect(error)) {
      const { navigate } = this.props.history;
      navigate(error.uri, { replace: true });
    } else {
      throw error;
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.context.location !== this.state.context.location) {
      this.props.history._onTransitionComplete();
    }
  }

  componentDidMount() {}

  componentWillUnmount() {
    this.unmounted = true;
    LocationProvider.refs.unlisten();
  }

  render() {
    const { context } = this.state;
    const { children } = this.props;
    return (
      <HistoryContext.Provider value={context}>
        {typeof children === "function" ? children(context) : children || null}
      </HistoryContext.Provider>
    );
  }
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

function Redirect(props) {
  redirectTo(props.to); // this will throw anyways
  return null;
}

export {
  useRouter,
  useLocation,
  useMatch,
  Link,
  LinkNav,
  LocationProvider,
  Redirect,
  isRedirect,
  redirectTo
};
