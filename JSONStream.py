import ijson
from pprint import pprint


# todo: make withable
def jsonp_advance(path):
    jsonp_file = open(path, "rb")
    json_file = open(path, "rb")
    while json_file.read(1) != bytes("[", encoding="utf-8"):
        pass
    json_file.seek(-1, 1)
    return json_file


def message_stream(path):
    json_file = jsonp_advance(path)
    parser = ijson.parse(json_file)

    conversation_id = ""
    in_message = False
    message = {}
    current_dict = message

    for prefix, event, value in parser:
        if prefix == "item.dmConversation.conversationId":
            conversation_id = value
        if prefix.startswith(tuple("item.dmConversation.messages.item." + x + "." for x in
                                   ("messageCreate", "joinConversation", "participantsJoin", "participantsLeave",
                                    "conversationNameUpdate"))):
            key = prefix.split(".")[-1]
            in_message = True
            message["type"] = prefix.split(".")[4]
            if event == "start_array":
                message[key] = []
            elif event == "start_map":
                array_name = prefix.split(".")[-2]
                message[array_name].append({})
                current_dict = message[array_name][-1]
            elif event == "end_map":
                current_dict = message
            elif event in ["string", "null", "boolean", "integer", "double", "number"]:
                if key == "item":
                    array_name = prefix.split(".")[-2]
                    message[array_name].append(value)
                else:
                    current_dict[key] = value
        elif prefix == "item.dmConversation.messages.item" and in_message:
            message["conversationId"] = conversation_id
            yield message
            message = {}
            current_dict = message
            in_message = False
    json_file.close()


def prefix_finder(path):
    json_file = jsonp_advance(path)
    prefixes = set()
    for p, e, v in ijson.parse(json_file):
        prefixes.add(p)
    json_file.close()
    return prefixes


def dump(path):
    json_file = jsonp_advance(path)
    for prefix, event, value in ijson.parse(json_file):
        print("prefix=" + prefix + ", event=" + event + ", value=" + str(value))
    json_file.close()


def test(path):
    dump(path)
    pprint(prefix_finder(path))
    for message in message_stream(path):
        pprint(message, width=200)


if __name__ == "__main__":
    test("./testdata/test.js")
