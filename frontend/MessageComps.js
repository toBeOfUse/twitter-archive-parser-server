import React, { useState, useRef, useEffect, forwardRef } from "react";
import { useLocation, useHistory, Link } from "react-router-dom";
import {
  zToLocaleDateTime,
  zToLocaleDate,
  zStringDiffMinutes,
} from "./DateHandling";
import SearchBar from "./SearchBar";
import LoadingSpinner from "./LoadingSpinner";
import { useDispatch, useSelector } from "react-redux";

function getTime(message) {
  if (message.schema == "Message") {
    return message.sent_time;
  } else if (message.schema == "NameUpdate") {
    return message.update_time;
  } else {
    return message.time;
  }
}

function getUserID(message) {
  return message?.sender || message?.initiator || message?.participant;
}

const reactionEmojis = {
  like: "❤️",
  agree: "👍",
  disagree: "👎",
  funny: "😂",
  excited: "🔥",
  sad: "😢",
  surprised: "😲",
};

function MessagePage(props) {
  const location = useLocation();
  const history = useHistory();

  const { startingPlace } = props;

  const locationKey = location.key + location.search;

  const savedState = useSelector((state) => state.pageState[locationKey]);

  const DOMState = useRef({
    // dom elements to be observed
    messagesPane: null,
    topMessage: null,
    bottomMessage: null,
    signpostElement: null,
    highlightElement: null,
    // measurements that assist with scroll position preservation in restoreScroll
    prevSignpostPosition: -1,
    prevScrollTop: savedState?.scrollTop || 0,
    // used to store a cleanup function for the history listener that will be created
    // in this render
    prevSaveStateCleanup: null,
  }).current;

  const [messages, setMessages] = useState(savedState?.messages);
  const [hitTop, setHitTop] = useState(
    savedState?.hitTop ?? startingPlace == "beginning"
  );
  const [hitBottom, setHitBottom] = useState(
    savedState?.hitBottom ?? startingPlace == "end"
  );

  // loading could currently be converted to a ref/instance variable but it could
  // also be used in rendering to display a spinner in the future so idk
  let [loading, setLoading] = useState(false);

  const dispatch = useDispatch();

  const [fullUserMeta, setFullUserMeta] = useState(null);

  const getUserMeta = () => {
    // if we're displaying a user's messages, we need the time span that those
    // messages take place in to pass to the time travel modal in the SearchBar
    // component, which means fetching their full user data
    if (props.type == "user") {
      fetch("/api/user?id=" + props.id).then((r) =>
        r.json().then((j) => {
          setFullUserMeta(j);
        })
      );
    }
  };

  useEffect(getUserMeta, []);

  const meta = useSelector((state) => {
    // most meta information will be populated by calls to dispatch when the first
    // message(s) load
    if (props.type == "conversation") {
      return state.conversations[props.id];
    } else if (props.type == "user") {
      // this is handled above
      return fullUserMeta;
    } else {
      return state.stats;
    }
  });

  let timeSpan;
  let name;
  if (meta) {
    if (props.type == "conversation") {
      name = meta.name;
      timeSpan = [meta.first_time, meta.last_time];
      document.title = meta.name;
    } else if (props.type == "user") {
      name =
        "from " +
        (meta.nickname || meta.display_name + " (@" + meta.handle + ")");
      timeSpan = meta.first_appearance && [
        meta.first_appearance,
        meta.last_appearance,
      ];
      document.title = "Messages from " + (meta.nickname || "@" + meta.handle);
    } else {
      name = "All Messages";
      timeSpan = [meta.earliest_message, meta.latest_message];
      document.title = "All Messages";
    }
  }

  let infoButton;
  if (props.type) {
    infoButton = (
      <Link to={`/${props.type}/info/` + props.id}>
        <img className="conversationInfoIcon" src="/assets/svg/info.svg" />
      </Link>
    );
  }

  DOMState.prevSaveStateCleanup && DOMState.prevSaveStateCleanup();
  const saveState = (_newLocation, action) => {
    if ((action == "PUSH" || action == "POP") && messages) {
      console.log("MESSAGES: saving current state under key", locationKey);
      console.log("MESSAGES: event is", action);
      dispatch({
        type: "pageState/save",
        payload: {
          [locationKey]: {
            messages,
            hitTop,
            hitBottom,
            scrollTop: DOMState.prevScrollTop,
          },
        },
      });
    }
    DOMState.prevSaveStateCleanup();
  };
  DOMState.prevSaveStateCleanup = history.listen(saveState);

  const restoreScroll = () => {
    // the strategy for maintaining the scroll position in the messages pane even as
    // its contents change wildly is as follows:  right before the messages inside
    // messagePane are updated via a call to setMessages, DOMState.signpostElement is
    // set to the DOM node of a message that is going to continue to exist after the
    // update and DOMState.prevSignpostPosition is set to its pre-update offsetTop
    // position. then, when the messages change, this effect is called, and we obtain
    // the element's updated position; the change in the signpost element's position
    // is then applied to the message pane's pre-update scroll position; therefore,
    // the scroll position remains the same relative to the messages that were
    // previously on the page.
    if (!messages || !messages.length) {
      return;
    }
    const currentPane = DOMState.messagesPane;
    console.log("MESSAGES: restoring scroll position for", locationKey);
    console.log("MESSAGES: it is currently", currentPane?.scrollTop);
    console.log(
      "MESSAGES: we are restoring it to its previous position,",
      savedState?.scrollTop
    );
    if (savedState?.scrollTop) {
      currentPane.scrollTop = savedState.scrollTop;
      dispatch({ type: "pageState/markScrollPosUsed", payload: locationKey });
    } else if (currentPane) {
      currentPane.focus();
      if (DOMState.signpostElement) {
        console.log(
          "MESSAGES: signpost used to be at",
          DOMState.prevSignpostPosition
        );
        console.log(
          "MESSAGES: signpost is now at",
          DOMState.signpostElement.offsetTop
        );
        const delta =
          DOMState.signpostElement.offsetTop - DOMState.prevSignpostPosition;
        currentPane.scrollTop = DOMState.prevScrollTop + delta;
      } else {
        // if the signpost value is null, this is the first render
        const currentScrollHeight = currentPane.scrollHeight;
        // if this is the first load, we have to make sure that the messages
        // are scrolled to that are indicated by the startingPlace parameter.
        if (startingPlace == "end") {
          currentPane.scrollTop = currentScrollHeight;
        } else if (startingPlace == "beginning") {
          currentPane.scrollTop = 0;
        } else {
          let el;
          if (DOMState.highlightElement) {
            // if there is a message id in the /:message_id? route parameter and we
            // are currently rendering it, the render function assigns a reference to
            // it to DOMState.highlightElement in distributeRefs below
            el = DOMState.highlightElement;
          } else if (startingPlace && !isNaN(Date.parse(startingPlace))) {
            // if we don't have a message to scroll to but rather a timestamp in the
            // start query parameter (which is what startingPlace stores) then we
            // will use a binary search to find the message closest to that timestamp
            // and scroll to it. (we ignore startingPlace if it isn't a valid timestamp)
            let index;
            if (getTime(messages[0]) > startingPlace) {
              index = 0;
            } else if (getTime(messages[messages.length - 1]) < startingPlace) {
              index = messages.length - 1;
            } else {
              let low = 0;
              let high = messages.length - 1;
              while (low <= high) {
                let mid = Math.floor((high + low) / 2);
                if (startingPlace < getTime(messages[mid])) {
                  high = mid - 1;
                } else {
                  low = mid + 1;
                }
              }
              index =
                zStringDiffMinutes(getTime(messages[low]), startingPlace) <
                zStringDiffMinutes(getTime(messages[high]), startingPlace)
                  ? low
                  : high;
            }
            el = messagesPane.children[index];
          }
          currentPane.scrollTop =
            el.offsetTop -
            currentPane.offsetTop -
            currentPane.offsetHeight / 2 +
            el.offsetHeight / 2;
        }
      }
    }
  };

  useEffect(restoreScroll, [messages]);

  const findMiddleMessage = () => {
    // this function is called when the time travel modal is opened by searchBar; it
    // finds the message in the middle of the messages pane and returns its
    // timestamp, so that the time travel modal can initially show the current time.
    if (messages) {
      const pane = DOMState.messagesPane;
      const midHeight = pane.scrollTop + pane.offsetHeight / 2;
      let index;
      let low = 0;
      let high = pane.children.length - 1;
      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        if (pane.children[mid].offsetTop < midHeight) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      index =
        pane.children[low].offsetTop - midHeight <
        midHeight - pane.children[high].offsetTop
          ? low
          : high;
      return getTime(messages[index]);
    }
  };

  const loadMore = (direction) => {
    if (loading) {
      return;
    }
    setLoading(true);
    // we need the change the captured value for "loading" to prevent staleness if a
    // single version of this function is called twice (once because it's passed to
    // useEffect and once because of it being used as a scroll event listener)
    loading = true;

    const url = "/api/messages?";
    const nextQueries = new URLSearchParams();

    if (props.type == "conversation") {
      nextQueries.set("conversation", props.id);
    } else if (props.type == "user") {
      nextQueries.set("byuser", props.id);
    }
    if (props.search) {
      nextQueries.set("search", props.search);
    }

    if (direction == "start") {
      if (props.message_id) {
        nextQueries.set("message", props.message_id);
      } else if (startingPlace == "beginning") {
        nextQueries.set("after", "beginning");
      } else if (startingPlace == "end") {
        nextQueries.set("before", "end");
      } else {
        nextQueries.set("at", startingPlace);
      }
    } else if (direction == "down") {
      nextQueries.set("after", getTime(messages[messages.length - 1]));
    } else if (direction == "up") {
      nextQueries.set("before", getTime(messages[0]));
    }
    fetch(url + nextQueries.toString()).then((r) =>
      r.json().then((j) => {
        dispatch({
          type: "users/addUsers",
          payload: j.users,
        });
        dispatch({
          type: "conversations/addConversations",
          payload: j.conversations,
        });
        let newMessages = null;
        if (direction == "start") {
          if (j.results.length) {
            newMessages = j.results;
          } else {
            setHitBottom(true);
            setHitTop(true);
          }
        } else if (direction == "down") {
          if (j.results.length) {
            newMessages = messages.concat(j.results);
          } else {
            setHitBottom(true);
          }
        } else if (direction == "up") {
          if (j.results.length) {
            newMessages = j.results.concat(messages);
          } else {
            setHitTop(true);
          }
        }
        if (newMessages) {
          const newLength = newMessages.length;
          if (newLength > 100) {
            if (direction == "down") {
              newMessages = newMessages.slice(newLength - 100, newLength);
              if (hitTop) {
                setHitTop(false);
              }
            } else if (direction == "up") {
              newMessages = newMessages.slice(0, 100);
              if (hitBottom) {
                setHitBottom(false);
              }
            }
          }
          if (direction == "up") {
            DOMState.signpostElement = DOMState.topMessage;
            DOMState.prevSignpostPosition = DOMState.topMessage.offsetTop;
          } else if (direction == "down") {
            DOMState.signpostElement = DOMState.bottomMessage;
            DOMState.prevSignpostPosition = DOMState.bottomMessage.offsetTop;
          }
          setMessages(newMessages);
        }
        setLoading(false);
      })
    );
  };

  const scrollChecks = () => {
    const el = DOMState.messagesPane;
    const currentScrollTop = el.scrollTop;
    DOMState.prevScrollTop = currentScrollTop;
    if (loading) {
      return;
    }
    if (!messages && !(hitTop && hitBottom)) {
      loadMore("start");
    } else if (el.scrollHeight < el.parentElement.scrollHeight) {
      if (!hitTop) {
        loadMore("up");
      } else if (!hitBottom) {
        loadMore("down");
      }
    } else if (
      el.scrollTop + el.offsetHeight > el.scrollHeight - 400 &&
      !hitBottom
    ) {
      loadMore("down");
    } else if (el.scrollTop < 400 && !hitTop) {
      loadMore("up");
    }
  };

  useEffect(scrollChecks);

  const distributeRefs = (message) => {
    return (node) => {
      if (message.id == props.message_id) {
        DOMState.highlightElement = node;
      }
      if (message.id == messages[0].id) {
        DOMState.topMessage = node;
      }
      if (message.id == messages[messages.length - 1].id) {
        DOMState.bottomMessage = node;
      }
    };
  };

  let renderedMessages = null;
  if (messages?.length) {
    let nextUser = getUserID(messages[0]);
    renderedMessages = [];
    !hitTop && renderedMessages.push(<LoadingSpinner key="topSpinner" />);
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const user = nextUser;
      nextUser = getUserID(messages[i + 1]);
      renderedMessages.push(
        <ComplexMessage
          {...message}
          showContextLink={!!props.search}
          sameUserAsNext={
            nextUser &&
            user == nextUser &&
            messages[i + 1]?.schema == "Message" &&
            zStringDiffMinutes(getTime(message), getTime(messages[i + 1])) < 2
          }
          highlight={message.id == props.message_id}
          context={props.type}
          ref={distributeRefs(message)}
          key={message.id}
        />
      );
    }
    !hitBottom && renderedMessages.push(<LoadingSpinner key="bottomSpinner" />);
  } else if (hitTop && hitBottom) {
    renderedMessages = <p>No messages found, sorry :(</p>;
  } else {
    renderedMessages = <LoadingSpinner />;
  }

  return (
    <>
      <div id="messagesPaneHeader">
        <h1 style={{ display: "inline", marginRight: 5 }}>
          {name} {infoButton}
        </h1>
        <br />
        <Link
          replace
          to={
            (props.type ? "/" + props.type : "") +
            "/messages" +
            (props.id ? "/" + props.id : "") +
            "?start=beginning" +
            (props.search ? "&search=" + props.search : "")
          }
        >
          Go to beginning
        </Link>
        {" | "}
        <Link
          replace
          to={
            (props.type ? "/" + props.type : "") +
            "/messages" +
            (props.id ? "/" + props.id : "") +
            "?start=end" +
            (props.search ? "&search=" + props.search : "")
          }
        >
          Go to end
        </Link>
        {" | "}
        Double-click/tap messages for more context
      </div>
      <div
        ref={(n) => (DOMState.messagesPane = n)}
        onScroll={scrollChecks}
        id="messagesPane"
      >
        {renderedMessages}
      </div>
      <SearchBar
        baseURL={"/" + props.type + "/messages/" + props.id}
        timeSpan={timeSpan}
        getDefaultTime={findMiddleMessage}
        placeholder={`Search ${
          props.type == "conversation"
            ? "conversation"
            : props.type == "user"
            ? "user's messages"
            : "all messages"
        }...`}
      />
    </>
  );
}

function MediaItem(props) {
  const autoplayAllowed = useSelector((state) => state.autoplay);
  const dispatch = useDispatch();
  const detectAutoplay = (event) => {
    if (props.media.type == "gif" && event.target) {
      const el = event.target;
      console.log("MEDIA: loaded gif element", el);
      el.setAttribute("muted", "");
      el.play().catch((err) => {
        console.log("MEDIA: detected autoplay not allowed :(", err);
        dispatch({
          type: "autoplay/allowed",
          payload: false,
        });
      });
    }
  };
  const [haveStartedPlaying, setHaveStartedPlaying] = useState(false);

  // the following is dangerously dependent on certain css properties staying the same
  const contentPaneWidth = Math.min(700, window.innerWidth);
  const maxMediaWidth = 0.7 * contentPaneWidth;
  const maxMediaHeight = 0.4 * window.innerHeight;
  let width, height;
  if (props.media.height > props.media.width) {
    height = Math.min(props.media.height, maxMediaHeight);
    width = props.media.width * (height / props.media.height);
  } else {
    width = Math.min(props.media.width, maxMediaWidth);
    height = props.media.height * (width / props.media.width);
  }
  const style = {
    height,
    width,
    ...props.style,
  };

  if (props.media.type == "image") {
    return (
      <img
        onDoubleClick={props.onDoubleClick}
        className={props.className}
        style={style}
        src={props.media.src}
        ref={(node) => {
          if (!node) {
            return;
          }
        }}
      />
    );
  } else if (props.media.type == "video") {
    return (
      <video
        onDoubleClick={props.onDoubleClick}
        controls
        className={props.className}
        style={style}
        src={props.media.src}
      />
    );
  } else if (props.media.type == "gif") {
    const gif = (
      <video
        playsInline
        muted
        autoPlay
        loop
        onDoubleClick={props.onDoubleClick}
        onLoadedData={detectAutoplay}
        className={props.className}
        src={props.media.src}
        style={style}
      />
    );
    if (!autoplayAllowed) {
      return (
        <div style={{ position: "relative" }}>
          {gif}
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 40,
              cursor: "pointer",
              display: haveStartedPlaying ? "none" : "",
            }}
            onClick={() => {
              el.current && el.current.play();
              setHaveStartedPlaying(true);
            }}
          >
            ▶️
          </span>
        </div>
      );
    } else {
      return gif;
    }
  } else {
    console.error(
      "media item of type " +
        props.media.type +
        " received; type not recognized"
    );
    console.error(JSON.stringify(props.media, null, 2));
    return null;
  }
}

function SimpleMessage(message) {
  if (message.schema !== "Message") {
    return null;
  }
  const el = document.createElement("p");
  el.innerHTML = message.html_content;
  for (const a of el.querySelectorAll("a")) {
    a.target = "_blank";
  }
  const user = useSelector((state) => state.users[message.sender]);
  const mediaItems = message.media.map((i) => (
    <MediaItem media={i} key={i.id} className="smallMedia" />
  ));
  return (
    <>
      {mediaItems}
      <p style={{ textAlign: "center" }}>
        <span dangerouslySetInnerHTML={{ __html: el.innerHTML }}></span>
        {" - "}
        <Link to={"/user/info/" + user.id}>
          {(user.nickname || user.display_name) + ` (@${user.handle})`}
        </Link>
        {", " + zToLocaleDate(message.sent_time) + " "}
        <Link
          to={
            "/conversation/messages/" + message.conversation + "/" + message.id
          }
        >
          (context)
        </Link>
      </p>
    </>
  );
}

const messageTypes = {};

messageTypes["NameUpdate"] = function NameUpdateContent(update) {
  const user = useSelector((state) => state.users[update.initiator]);
  return (
    <p style={{ textAlign: "center" }}>
      <Link to={"/user/info/" + user.id}>
        {user.nickname || `@${user.handle}`}
      </Link>{" "}
      changed{" "}
      {update.context != "conversation" ? (
        <Link to={"/conversation/info/" + update.conversation}>
          the conversation
        </Link>
      ) : (
        "the conversation"
      )}
      's name to {update.new_name} ({zToLocaleDateTime(update.update_time)})
    </p>
  );
};

messageTypes["ParticipantJoin"] = function ParticipantJoinContent(event) {
  const added = useSelector((state) => state.users[event.participant]);
  const adder = useSelector((state) => state.users[event.added_by]);
  const conversation = useSelector(
    (state) => state.conversations[event.conversation]
  );
  return (
    <p style={{ textAlign: "center" }}>
      <Link to={"/user/info/" + added.id}>
        {added.nickname || `@${added.handle}`}
      </Link>{" "}
      was added to {conversation.name} by{" "}
      <Link to={"/user/info/" + adder.id}>
        {adder.nickname || `@${adder.handle}`}
      </Link>
      . ({zToLocaleDateTime(event.time)})
    </p>
  );
};

messageTypes["ParticipantLeave"] = function ParticipantLeaveContent(event) {
  const user = useSelector((state) => state.users[event.participant]);
  const conversation = useSelector(
    (state) => state.conversations[event.conversation]
  );
  return (
    <p style={{ textAlign: "center" }}>
      <Link to={"/user/info/" + user.id}>
        {user.nickname || `@${user.handle}`}
      </Link>{" "}
      left {conversation.name}. ({zToLocaleDateTime(event.time)})
    </p>
  );
};

messageTypes["Message"] = function NormalMessageContent(message) {
  const user = useSelector((state) => state.users[message.sender]);
  const alignment = user.is_main_user
    ? { marginLeft: "auto" }
    : { marginRight: "auto" };
  let textSection = null;
  if (message.html_content) {
    const el = document.createElement("p");
    el.innerHTML = message.html_content;
    for (const a of el.querySelectorAll("a")) {
      a.target = "_blank";
    }
    textSection = (
      <p
        style={{
          ...alignment,
          backgroundColor: message.highlight ? "#ff7878" : "#96d3ff",
        }}
        onDoubleClick={() => message.openModal()}
        // prevents double clicks from causing selection
        onMouseDown={(e) => {
          if (e.detail > 1) {
            e.preventDefault();
          }
        }}
        className="messageText"
        dangerouslySetInnerHTML={{ __html: el.innerHTML }}
      />
    );
  }
  const mediaItems = message.media.map((i) => (
    <MediaItem
      onDoubleClick={() => message.openModal()}
      media={i}
      key={i.id}
      style={alignment}
    />
  ));
  return (
    <>
      {mediaItems}
      {textSection}
      {!message.sameUserAsNext && (
        <>
          <span className="messageAttribution" style={alignment}>
            <Link to={"/user/info/" + user.id}>
              {(user.nickname || user.display_name) + ` (@${user.handle})`}
            </Link>
            {", " + zToLocaleDateTime(message.sent_time)}
          </span>
          {message.showContextLink && (
            <Link
              to={
                "/conversation/messages/" +
                message.conversation +
                "/" +
                message.id
              }
              className="messageAttribution"
              style={alignment}
            >
              (see in context)
            </Link>
          )}
          {!!message.reactions.length && (
            <span
              style={{
                padding: 3,
                border: "1px solid black",
                backgroundColor: "#ccc",
                borderRadius: 4,
                marginTop: 2,
                ...alignment,
              }}
            >
              {message.reactions
                .map((r) => reactionEmojis[r.emotion])
                .join(" ")}
            </span>
          )}
        </>
      )}
    </>
  );
};

function MessageInfoModal(message) {
  const conversationLink =
    "/conversation/messages/" + message.conversation + "/" + message.id;
  const userMessagesLink =
    "/user/messages/" + message.sender + "/" + message.id;
  const allMessagesLink = "/messages/" + message.id;
  const copyLinkHref = (e) => {
    e.preventDefault();
    navigator.clipboard
      .writeText(e.target.href)
      .then(() => (e.target.innerHTML += " (copied!)"))
      .catch((err) => {
        console.log("MESSAGES MODAL: copying error", err);
        e.target.innerHTML =
          "copying forbidden by your browser settings :( " +
          "right click or long press to copy this link";
      });
  };
  const user = useSelector((state) => state.users[message.sender]);
  // for reaction attribution
  const users = useSelector((state) => state.users);
  const conversation = useSelector(
    (state) => state.conversations[message.conversation]
  );
  let contextLinks;
  const makeContextLink = (to, copyMode) => {
    return (
      <Link
        to={to}
        style={{ display: "block" }}
        onClick={copyMode ? copyLinkHref : null}
        key={to}
      >
        {(copyMode ? "Copy link to " : "View ") +
          (to == conversationLink
            ? "conversation"
            : to == userMessagesLink
            ? "user's messages"
            : "all messages") +
          " at this point"}
      </Link>
    );
  };
  if (message.context == "conversation") {
    contextLinks = [
      makeContextLink(conversationLink, true),
      makeContextLink(userMessagesLink, false),
      makeContextLink(allMessagesLink, false),
    ];
  } else if (message.context == "user") {
    contextLinks = [
      makeContextLink(userMessagesLink, true),
      makeContextLink(conversationLink, false),
      makeContextLink(allMessagesLink, false),
    ];
  } else {
    contextLinks = [
      makeContextLink(allMessagesLink, true),
      makeContextLink(conversationLink, false),
      makeContextLink(userMessagesLink, false),
    ];
  }
  return (
    <div className="modalBackdrop" onClick={() => message.closeModal()}>
      <div
        className="centeredModal"
        onClick={(e) => e.stopPropagation()}
        style={{ textAlign: "center" }}
      >
        <h3>
          Sent by {(user.nickname || user.display_name) + ` (@${user.handle}) `}
          {message.context != "conversation" && (
            <span>
              in{" "}
              <Link to={"/conversation/info/" + conversation.id}>
                {conversation.name}
              </Link>
            </span>
          )}{" "}
          at {zToLocaleDateTime(message.sent_time)}
        </h3>
        {contextLinks}
        {message.reactions.map((v) => (
          <p key={v.id}>
            {reactionEmojis[v.emotion]} left by{" "}
            {users[v.creator].nickname || `@${users[v.creator].handle}`} at{" "}
            {zToLocaleDateTime(v.creation_time)}
          </p>
        ))}
        <button onClick={() => message.closeModal()}>Close</button>
      </div>
    </div>
  );
}

const ComplexMessage = forwardRef(function FullMessage(message, ref) {
  const [modalOpen, setModalOpen] = useState(false);
  let containerClass = "messageContainer";
  if (message.schema == "Message" && !message.sameUserAsNext) {
    containerClass += " marginedMessage";
  }
  const MessageShape = messageTypes[message.schema];
  return (
    <div ref={ref} className={containerClass}>
      <MessageShape {...message} openModal={() => setModalOpen(true)} />
      {modalOpen && (
        <MessageInfoModal {...message} closeModal={() => setModalOpen(false)} />
      )}
    </div>
  );
});

export { MessagePage, SimpleMessage };
