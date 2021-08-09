var debug = false;
var websock;
var password = false;
var maxNetworks;
var messages = [];
var free_size = 0;

var urls = {};

var numChanged = 0;
var numReboot = 0;
var numReconnect = 0;
var numReload = 0;
var configurationSaved = false;
var ws_pingpong;


var now = 0;
var ago = 0;


// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

function initMessages() {
    messages[1]  = "Remote update started";
    messages[2]  = "OTA update started";
    messages[3]  = "Error parsing data!";
    messages[4]  = "The file does not look like a valid configuration backup or is corrupted";
    messages[5]  = "Changes saved. You should reboot your board now";
    messages[7]  = "Passwords do not match!";
    messages[8]  = "Changes saved";
    messages[9]  = "No changes detected";
    messages[10] = "Session expired, please reload page...";
}

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

$.fn.enterKey = function (fnc) {
    return this.each(function () {
        $(this).keypress(function (ev) {
            var keycode = parseInt(ev.keyCode ? ev.keyCode : ev.which, 10);
            if (13 === keycode) {
                return fnc.call(this, ev);
            }
        });
    });
};

function followScroll(id, threshold) {
    if (threshold === undefined) {
        threshold = 90;
    }

    var elem = document.getElementById(id);
    var offset = (elem.scrollTop + elem.offsetHeight) / elem.scrollHeight * 100;
    if (offset > threshold) {
        elem.scrollTop = elem.scrollHeight;
    }
}

function fromSchema(source, schema) {
    if (schema.length !== source.length) {
        throw "Schema mismatch!";
    }

    var target = {};
    schema.forEach(function(key, index) {
        target[key] = source[index];
    });

    return target;
}

function keepTime() {

    $("span[name='ago']").html(ago);
    ago++;

    if (0 === now) { return; }
    var date = new Date(now * 1000);
    var text = date.toISOString().substring(0, 19).replace("T", " ");
    $("input[name='now']").val(text);
    $("span[name='now']").html(text);
    now++;

}

function zeroPad(number, positions) {
    return number.toString().padStart(positions, "0");
}

function validatePassword(password) {
    // http://www.the-art-of-web.com/javascript/validate-password/
    // at least one lowercase and one uppercase letter or number
    // at least eight characters (letters, numbers or special characters)

    // MUST be 8..63 printable ASCII characters. See:
    // https://en.wikipedia.org/wiki/Wi-Fi_Protected_Access#Target_users_(authentication_key_distribution)
    // https://github.com/xoseperez/espurna/issues/1151

    var re_password = /^(?=.*[A-Z\d])(?=.*[a-z])[\w~!@#$%^&*\(\)<>,.\?;:{}\[\]\\|]{8,63}$/;
    return (
        (password !== undefined)
        && (typeof password === "string")
        && (password.length > 0)
        && re_password.test(password)
    );
}

function validateFormPasswords(form) {
    var passwords = $("input[name='adminPass1'],input[name='adminPass2']", form);
    var adminPass1 = passwords.first().val(),
        adminPass2 = passwords.last().val();

    var formValidity = passwords.first()[0].checkValidity();
    if (formValidity && (adminPass1.length === 0) && (adminPass2.length === 0)) {
        return true;
    }

    var validPass1 = validatePassword(adminPass1),
        validPass2 = validatePassword(adminPass2);

    if (formValidity && validPass1 && validPass2) {
        return true;
    }

    if (!formValidity || (adminPass1.length > 0 && !validPass1)) {
        alert("The password you have entered is not valid, it must be 8..63 characters and have at least 1 lowercase and 1 uppercase / number!");
    }

    if (adminPass1 !== adminPass2) {
        alert("Passwords are different!");
    }

    return false;
}

function validateFormHostname(form) {
    // RFCs mandate that a hostname's labels may contain only
    // the ASCII letters 'a' through 'z' (case-insensitive),
    // the digits '0' through '9', and the hyphen.
    // Hostname labels cannot begin or end with a hyphen.
    // No other symbols, punctuation characters, or blank spaces are permitted.

    // Negative lookbehind does not work in Javascript
    // var re_hostname = new RegExp('^(?!-)[A-Za-z0-9-]{1,32}(?<!-)$');

    var re_hostname = new RegExp('^(?!-)[A-Za-z0-9-]{0,31}[A-Za-z0-9]$');

    var hostname = $("input[name='hostname']", form);
    if ("true" !== hostname.attr("hasChanged")) {
        return true;
    }

    if (re_hostname.test(hostname.val())) {
        return true;
    }

    alert("Hostname cannot be empty and may only contain the ASCII letters ('A' through 'Z' and 'a' through 'z'), the digits '0' through '9', and the hyphen ('-')! They can neither start or end with an hyphen.");

    return false;
}

function validateForm(form) {
    return validateFormPasswords(form) && validateFormHostname(form);
}

// Observe all group settings to selectively update originals based on the current data
var groupSettingsObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        // If any new elements are added, set "settings-target" element as changed to forcibly send the data
        var targets = $(mutation.target).attr("data-settings-target");
        if (targets !== undefined) {
            mutation.addedNodes.forEach(function(node) {
                var overrides = [];
                targets.split(" ").forEach(function(target) {
                    var elem = $("[name='" + target + "']", node);
                    if (!elem.length) return;

                    var value = getValue(elem);
                    if ((value === null) || (value === elem[0].defaultValue)) {
                        overrides.push(elem);
                    }
                });
                setOriginalsFromValues($("input,select", node));
                overrides.forEach(function(elem) {
                    elem.attr("hasChanged", "true");
                    if (elem.prop("tagName") === "SELECT") {
                        elem.prop("value", 0);
                    }
                });
            });
        }

        // If anything was removed, forcibly send **all** of the group to avoid having any outdated keys
        // TODO: hide instead of remove?
        var changed = $(mutation.target).attr("hasChanged") === "true";
        if (changed || mutation.removedNodes.length) {
            $(mutation.target).attr("hasChanged", "true");
            $("input,select", mutation.target.childNodes).attr("hasChanged", "true");
        }
    });
});

// These fields will always be a list of values
function isGroupValue(value) {
    var names = [
        "ssid", "pass", "gw", "mask", "ip", "dns",
        "schEnabled", "schSwitch","schAction","schType","schHour","schMinute","schWDs","schUTC",
        "relayBoot", "relayPulse", "relayTime", "relayLastSch",
        "mqttGroup", "mqttGroupSync", "relayOnDisc",
        "dczRelayIdx", "dczMagnitude",
        "tspkRelay", "tspkMagnitude",
        "ledGPIO", "ledMode", "ledRelay",
        "adminPass",
        "node", "key", "topic",
        "rpnRule", "rpnTopic", "rpnName"
    ];
    return names.indexOf(value) >= 0;
}

function bitsetToValues(bitset) {
    var values = [];
    for (var index = 0; index < 31; ++index) {
        if (bitset & (1 << index)) {
            values.push(String(index));
        }
    }

    return values;
}

function valuesToBitset(values) {
    var result = 0;
    for (var value of values) {
        result |= 1 << parseInt(value);
    }

    return result;
}

function getValue(element) {

    if ($(element).attr("type") === "checkbox") {
        return $(element).prop("checked") ? 1 : 0;
    } else if ($(element).attr("type") === "radio") {
        if (!$(element).prop("checked")) {
            return null;
        }
    } else if ($(element).attr("multiple") !== undefined) {
        return valuesToBitset($(element).val());
    }

    return $(element).val();

}

function addValue(data, name, value) {

    if (name in data) {
        if (!Array.isArray(data[name])) {
            data[name] = [data[name]];
        }
        data[name].push(value);
    } else if (isGroupValue(name)) {
        data[name] = [value];
    } else {
        data[name] = value;
    }

}

function getData(form, changed, cleanup) {

    // Populate two sets of data, ones that had been changed and ones that stayed the same
    var data = {};
    var changed_data = [];
    if (cleanup === undefined) {
        cleanup = true;
    }

    if (changed === undefined) {
        changed = true;
    }

    $("input,select", form).each(function() {
        if ($(this).attr("data-settings-ignore") === "true") {
            return;
        }

        var name = $(this).attr("name");

        var real_name = $(this).attr("data-settings-real-name");
        if (real_name !== undefined) {
            name = real_name;
        }

        var value = getValue(this);
        if (null !== value) {
            var haschanged = ("true" === $(this).attr("hasChanged"));
            var indexed = changed_data.indexOf(name) >= 0;

            if ((haschanged || !changed) && !indexed) {
                changed_data.push(name);
            }

            addValue(data, name, value);
        }
    });

    // Finally, filter out only fields that had changed.
    // Note: We need to preserve dynamic lists like schedules, wifi etc.
    // so we don't accidentally break when user deletes entry in the middle
    var resulting_data = {};
    for (var value in data) {
        if (changed_data.indexOf(value) >= 0) {
            resulting_data[value] = data[value];
        }
    }

    // Hack: clean-up leftover arrays.
    // When empty, the receiving side will prune all keys greater than the current one.
    if (cleanup) {
        $(".group-settings").each(function() {
            var haschanged = ("true" === $(this).attr("hasChanged"));
            if (haschanged && !this.children.length) {
                var targets = this.dataset.settingsTarget;
                if (targets === undefined) return;

                targets.split(" ").forEach(function(target) {
                    resulting_data[target] = [];
                });
            }
        });
    }

    return resulting_data;

}

function randomString(length, args) {
    if (typeof args === "undefined") {
        args = {
            lowercase: true,
            uppercase: true,
            numbers: true,
            special: true
        }
    }

    var mask = "";
    if (args.lowercase) { mask += "abcdefghijklmnopqrstuvwxyz"; }
    if (args.uppercase) { mask += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; }
    if (args.numbers || args.hex) { mask += "0123456789"; }
    if (args.hex) { mask += "ABCDEF"; }
    if (args.special) { mask += "~`!@#$%^&*()_+-={}[]:\";'<>?,./|\\"; }

    var source = new Uint32Array(length);
    var result = new Array(length);

    window.crypto.getRandomValues(source).forEach(function(value, i) {
        result[i] = mask[value % mask.length];
    });

    return result.join("");
}

function generateAPIKey() {
    var apikey = randomString(16, {hex: true});
    $("input[name='apiKey']")
        .val(apikey)
        .attr("original", "-".repeat(16))
        .attr("haschanged", "true");
    return false;
}

function generatePassword() {
    var password = "";
    do {
        password = randomString(10);
    } while (!validatePassword(password));

    return password;
}

function toggleVisiblePassword() {
    var elem = this.previousElementSibling;
    if (elem.type === "password") {
        elem.type = "text";
    } else {
        elem.type = "password";
    }
    return false;
}

function doGeneratePassword() {
    var elems = $("input", $("#formPassword"));
    elems
        .val(generatePassword())
        .attr("haschanged", "true")
        .each(function() {
            this.type = "text";
        });
    return false;
}

function getJson(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return false;
    }
}

function moduleVisible(module) {
    if (module == "sch") {
        $("li.module-" + module).css("display", "inherit");
        $("div.module-" + module).css("display", "flex");
        return;
    }
    $(".module-" + module).css("display", "inherit");
}

//removeIf(!thermostat)
function checkTempRangeMin() {
    var min = parseInt($("#tempRangeMinInput").val(), 10);
    var max = parseInt($("#tempRangeMaxInput").val(), 10);
    if (min > max - 1) {
        $("#tempRangeMinInput").val(max - 1);
    }
}

function checkTempRangeMax() {
    var min = parseInt($("#tempRangeMinInput").val(), 10);
    var max = parseInt($("#tempRangeMaxInput").val(), 10);
    if (max < min + 1) {
        $("#tempRangeMaxInput").val(min + 1);
    }
}

function doResetThermostatCounters(ask) {
    var question = (typeof ask === "undefined" || false === ask) ?
        null :
        "Are you sure you want to reset burning counters?";
    return doAction(question, "thermostat_reset_counters");
}
//endRemoveIf(!thermostat)

function initSelectGPIO(select) {
    // TODO: properly lock used GPIOs via locking and apply the mask here
    var mapping = [
        [153, "NONE"],
        [0, "0 (FLASH)"],
        [1, "1 (U0TXD)"],
        [2, "2 (U1TXD)"],
        [3, "3 (U0RXD)"],
        [4, "4 (SDA)"],
        [5, "5 (SCL)"],
        [9, "9 (SDD2)"],
        [10, "10 (SDD3)"],
        [12, "12 (MTDI)"],
        [13, "13 (MTCK)"],
        [14, "14 (MTMS)"],
        [15, "15 (MTDO)"],
        [16, "16 (WAKE)"],
    ];
    for (n in mapping) {
        var elem = $('<option value="' + mapping[n][0] + '">');
        elem.html(mapping[n][1]);
        elem.appendTo(select);
    }
}


// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

function send(json) {
    if (debug) console.log(json);
    websock.send(json);
}

function sendAction(action, data) {
    send(JSON.stringify({action: action, data: data}));
}

function sendConfig(data) {
    send(JSON.stringify({config: data}));
}

function setOriginalsFromValues(elems) {
    if (typeof elems == "undefined") {
        elems = $("input,select");
    }
    elems.each(function() {
        var value;
        if ($(this).attr("type") === "checkbox") {
            value = $(this).prop("checked");
        } else {
            value = $(this).val();
        }
        $(this).attr("original", value);
        hasChanged.call(this);
    });
}

function resetOriginals() {
    setOriginalsFromValues();
    $(".group-settings").attr("haschanged", "false")
    numReboot = numReconnect = numReload = 0;
    configurationSaved = false;
}

function doReload(milliseconds) {
    setTimeout(function() {
        window.location.reload();
    }, parseInt(milliseconds, 10));
}

/**
 * Check a file object to see if it is a valid firmware image
 * The file first byte should be 0xE9
 * @param  {file}       file        File object
 * @param  {Function}   callback    Function to call back with the result
 */
function checkFirmware(file, callback) {

    var reader = new FileReader();

    reader.onloadend = function(evt) {
        if (FileReader.DONE === evt.target.readyState) {
            var magic = evt.target.result.charCodeAt(0);
            if ((0x1F === magic) && (0x8B === evt.target.result.charCodeAt(1))) {
                callback(true);
                return;
            }

            if (0xE9 !== magic) {
                alert("Binary image does not start with a magic byte");
                callback(false);
                return;
            }

            var modes = ['QIO', 'QOUT', 'DIO', 'DOUT'];
            var flash_mode = evt.target.result.charCodeAt(2);
            if (0x03 !== flash_mode) {
                var response = window.confirm("Binary image is using " + modes[flash_mode] + " flash mode! Make sure that the device supports it before proceeding.");
                callback(response);
            } else {
                callback(true);
            }
        }
    };

    var blob = file.slice(0, 3);
    reader.readAsBinaryString(blob);

}

function doUpgrade() {

    var file = $("input[name='upgrade']")[0].files[0];

    if (typeof file === "undefined") {
        alert("First you have to select a file from your computer.");
        return false;
    }

    if (file.size > free_size) {
        alert("Image it too large to fit in the available space for OTA. Consider doing a two-step update.");
        return false;
    }

    checkFirmware(file, function(ok) {

        if (!ok) {
            return;
        }

        var data = new FormData();
        data.append("upgrade", file, file.name);

        var xhr = new XMLHttpRequest();

        var msg_ok = "Firmware image uploaded, board rebooting. This page will be refreshed in 5 seconds.";
        var msg_err = "There was an error trying to upload the new image, please try again: ";

        var network_error = function(e) {
            alert(msg_err + " xhr request " + e.type);
        };
        xhr.addEventListener("error", network_error, false);
        xhr.addEventListener("abort", network_error, false);

        xhr.addEventListener("load", function(e) {
            $("#upgrade-progress").hide();
            if ("OK" === xhr.responseText) {
                alert(msg_ok);
                doReload(5000);
            } else {
                alert(msg_err + xhr.status.toString() + " " + xhr.statusText + ", " + xhr.responseText);
            }
        }, false);

        xhr.upload.addEventListener("progress", function(e) {
            $("#upgrade-progress").show();
            if (e.lengthComputable) {
                $("progress").attr({ value: e.loaded, max: e.total });
            }
        }, false);

        xhr.open("POST", urls.upgrade.href);
        xhr.send(data);

    });

    return false;

}

function doUpdatePassword() {
    var form = $("#formPassword");
    if (validateFormPasswords(form)) {
        sendConfig(getData(form, true, false));
    }
    return false;
}

function checkChanges() {

    if (numChanged > 0) {
        var response = window.confirm("Some changes have not been saved yet, do you want to save them first?");
        if (response) {
            doUpdate();
        }
    }

}

function doAction(question, action) {

    checkChanges();

    if (question) {
        var response = window.confirm(question);
        if (false === response) {
            return false;
        }
    }

    sendAction(action, {});
    doReload(5000);
    return false;

}

function doReboot(ask) {

    var question = (typeof ask === "undefined" || false === ask) ?
        null :
        "Are you sure you want to reboot the device?";
    return doAction(question, "reboot");

}

function doReconnect(ask) {

    var question = (typeof ask === "undefined" || false === ask) ?
        null :
        "Are you sure you want to disconnect from the current WIFI network?";
    return doAction(question, "reconnect");

}

function doCheckOriginals() {
    var response;

    if (numReboot > 0) {
        response = window.confirm("You have to reboot the board for the changes to take effect, do you want to do it now?");
        if (response) { doReboot(false); }
    } else if (numReconnect > 0) {
        response = window.confirm("You have to reconnect to the WiFi for the changes to take effect, do you want to do it now?");
        if (response) { doReconnect(false); }
    } else if (numReload > 0) {
        response = window.confirm("You have to reload the page to see the latest changes, do you want to do it now?");
        if (response) { doReload(0); }
    }

    resetOriginals();
}

function waitForSave(){
    if (!configurationSaved) {
        setTimeout(waitForSave, 1000);
    } else {
        doCheckOriginals();
    }
}

function doUpdate() {

    var forms = $(".form-settings");
    if (validateForm(forms)) {

        // Get data
        sendConfig(getData(forms));

        // Empty special fields
        $(".pwrExpected").val(0);
        $("input[name='snsResetCalibration']").prop("checked", false);
        $("input[name='pwrResetCalibration']").prop("checked", false);
        $("input[name='pwrResetE']").prop("checked", false);

        // Change handling
        numChanged = 0;

        waitForSave();

    }

    return false;

}

function doBackup() {
    document.getElementById("downloader").src = urls.config.href;
    return false;
}

function onFileUpload(event) {

    var inputFiles = this.files;
    if (typeof inputFiles === "undefined" || inputFiles.length === 0) {
        return false;
    }
    var inputFile = inputFiles[0];
    this.value = "";

    var response = window.confirm("Previous settings will be overwritten. Are you sure you want to restore this settings?");
    if (!response) {
        return false;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
        var data = getJson(e.target.result);
        if (data) {
            sendAction("restore", data);
        } else {
            window.alert(messages[4]);
        }
    };
    reader.readAsText(inputFile);

    return false;

}

function doRestore() {
    if (typeof window.FileReader !== "function") {
        alert("The file API isn't supported on this browser yet.");
    } else {
        $("#uploader").click();
    }
    return false;
}

function doFactoryReset() {
    var response = window.confirm("Are you sure you want to restore to factory settings?");
    if (!response) {
        return false;
    }
    sendAction("factory_reset", {});
    doReload(5000);
    return false;
}

function doToggle(id, value) {
    sendAction("relay", {id: id, status: value ? 1 : 0 });
    return false;
}

function doScan() {
    $("#scanResult").html("");
    $("div.scan.loading").show();
    $("#button-wifi-scan").attr("disabled", true);
    sendAction("scan", {});
    return false;
}

function doDebugCommand() {
    var el = $("input[name='dbgcmd']");
    var command = el.val();
    el.val("");
    sendAction("dbgcmd", {command: command});
    followScroll("weblog", 0);
    return false;
}

function doDebugClear() {
    $("#weblog").text("");
    return false;
}

//removeIf(!rfm69)

function doClearCounts() {
    sendAction("clear-counts", {});
    return false;
}

function doClearMessages() {
    packets.clear().draw(false);
    return false;
}

function doFilter(e) {
    var index = packets.cell(this).index();
    if (index == 'undefined') return;
    var c = index.column;
    var column = packets.column(c);
    if (filters[c]) {
        filters[c] = false;
        column.search("");
        $(column.header()).removeClass("filtered");
    } else {
        filters[c] = true;
        var data = packets.row(this).data();
        if (e.which == 1) {
            column.search('^' + data[c] + '$', true, false );
        } else {
            column.search('^((?!(' + data[c] + ')).)*$', true, false );
        }
        $(column.header()).addClass("filtered");
    }
    column.draw();
    return false;
}

function doClearFilters() {
    for (var i = 0; i < packets.columns()[0].length; i++) {
        if (filters[i]) {
            filters[i] = false;
            var column = packets.column(i);
            column.search("");
            $(column.header()).removeClass("filtered");
            column.draw();
        }
    }
    return false;
}

//endRemoveIf(!rfm69)

function delParent() {
    var parent = $(this).parent().parent();
    $(parent).remove();
}

// -----------------------------------------------------------------------------
// Visualization
// -----------------------------------------------------------------------------

function toggleMenu() {
    $("#layout").toggleClass("active");
    $("#menu").toggleClass("active");
    $("#menuLink").toggleClass("active");
}

function showPanel() {
    $(".panel").hide();
    if ($("#layout").hasClass("active")) { toggleMenu(); }
    $("#" + $(this).attr("data")).show();
}



// -----------------------------------------------------------------------------
// RPN Rules
// -----------------------------------------------------------------------------

function addRPNRule() {
    var template = $("#rpnRuleTemplate .pure-g")[0];
    var line = $(template).clone();
    var tabindex = $("#rpnRules > div").length + 100;
    $(line).find("input").each(function() {
        $(this).attr("tabindex", tabindex++);
    });
    $(line).find("button").on('click', delParent);
    setOriginalsFromValues($("input", line));
    line.appendTo("#rpnRules");
}

function addRPNTopic() {
    var template = $("#rpnTopicTemplate .pure-g")[0];
    var line = $(template).clone();
    var tabindex = $("#rpnTopics > div").length + 120;
    $(line).find("input").each(function() {
        $(this).attr("tabindex", tabindex++);
    });
    $(line).find("button").on('click', delParent);
    setOriginalsFromValues($("input", line));
    line.appendTo("#rpnTopics");
}


// -----------------------------------------------------------------------------
// Processing
// -----------------------------------------------------------------------------

function processData(data) {

    if (debug) console.log(data);

    // title
    if ("app_name" in data) {
        var title = data.app_name;
        if ("app_version" in data) {
            $("span[name=title]").html(data.app_version);
            title = title + " " + data.app_version;
        }
        if ("hostname" in data) {
            title = data.hostname + " - " + title;
        }
        document.title = title;
    }

    Object.keys(data).forEach(function(key) {

        var i;
        var value = data[key];

        // ---------------------------------------------------------------------
        // Web mode
        // ---------------------------------------------------------------------

        if ("webMode" === key) {
            password = (1 === value);
            $("#layout").toggle(!password);
            $("#password").toggle(password);
        }

        // ---------------------------------------------------------------------
        // Actions
        // ---------------------------------------------------------------------

        if ("action" === key) {
            if ("reload" === data.action) { doReload(1000); }
            return;
        }

            // ---------------------------------------------------------------------
        // WiFi
        // ---------------------------------------------------------------------

        if ("wifi" === key) {
            maxNetworks = parseInt(value["max"], 10);
            value["networks"].forEach(function(network) {
                addNetwork(fromSchema(network, value.schema));
            });
            return;
        }

        if ("scanResult" === key) {
            $("div.scan.loading").hide();
            $("#button-wifi-scan").attr("disabled", false);
            $("#scanResult").show();
        }

        // ---------------------------------------------------------------------
        // HTTP API
        // ---------------------------------------------------------------------

        // Auto generate an APIKey if none defined yet
        if ("apiVisible" === key) {
            if (data.apiKey === undefined || data.apiKey === "") {
                generateAPIKey();
            }
        }

        // ---------------------------------------------------------------------
        // General
        // ---------------------------------------------------------------------

        // Messages
        if ("message" === key) {
            if (value == 8) {
                configurationSaved = true;
            }
            window.alert(messages[value]);
            return;
        }

        // Web log
        if ("weblog" === key) {
            send("{}");

            var msg = value["msg"];
            var pre = value["pre"];

            for (var i=0; i < msg.length; ++i) {
                if (pre[i]) {
                    $("#weblog").append(new Text(pre[i]));
                }
                $("#weblog").append(new Text(msg[i]));
            }

            followScroll("weblog");
            return;
        }

        // Enable options
        var position = key.indexOf("Visible");
        if (position > 0 && position === key.length - 7) {
            var module = key.slice(0,-7);
            moduleVisible(module);
            return;
        }

        if ("deviceip" === key) {
            var a_href = $("span[name='" + key + "']").parent();
            a_href.attr("href", "//" + value);
            a_href.next().attr("href", "telnet://" + value);
        }

        if ("now" === key) {
            now = parseInt(value, 10);
            return;
        }

        if ("free_size" === key) {
            free_size = parseInt(value, 10);
        }

        // Pre-process
        if ("mqttStatus" === key) {
            value = value ? "CONNECTED" : "NOT CONNECTED";
        }
        if ("ntpStatus" === key) {
            value = value ? "SYNC'D" : "NOT SYNC'D";
        }
        if ("uptime" === key) {
            ago = 0;
            var uptime  = parseInt(value, 10);
            var seconds = uptime % 60; uptime = parseInt(uptime / 60, 10);
            var minutes = uptime % 60; uptime = parseInt(uptime / 60, 10);
            var hours   = uptime % 24; uptime = parseInt(uptime / 24, 10);
            var days    = uptime;
            value = days + "d " + zeroPad(hours, 2) + "h " + zeroPad(minutes, 2) + "m " + zeroPad(seconds, 2) + "s";
        }
        //removeIf(!thermostat)
        if ("tmpUnits" == key) {
            $("span.tmpUnit").html(data[key] == 3 ? "ºF" : "ºC");
        }
        //endRemoveIf(!thermostat)

        // ---------------------------------------------------------------------
        // Matching
        // ---------------------------------------------------------------------
        var elems = [];

        var pre;
        var post;

        // Look for INPUTs
        var input = $("input[name='" + key + "']");
        if (input.length > 0) {
            if (input.attr("type") === "checkbox") {
                input.prop("checked", value);
            } else if (input.attr("type") === "radio") {
                input.val([value]);
            } else {
                pre = input.attr("pre") || "";
                post = input.attr("post") || "";
                input.val(pre + value + post);
            }
            elems.push(input);
        }

        // Look for SPANs
        var span = $("span[name='" + key + "']");
        if (span.length > 0) {
            if (Array.isArray(value)) {
                value.forEach(function(elem) {
                    span.append(elem);
                    span.append('</br>');
                    elems.push(span);
                });
            } else {
                pre = span.attr("pre") || "";
                post = span.attr("post") || "";
                span.html(pre + value + post);
                elems.push(span);
            }
        }

        // Look for SELECTs
        var select = $("select[name='" + key + "']");
        if (select.length > 0) {
            if (select.attr("multiple") !== undefined) {
                select.val(bitsetToValues(value));
            } else {
                select.val(value);
            }
            elems.push(select);
        }

        setOriginalsFromValues($(elems));

    });

}

function hasChanged() {

    var newValue, originalValue;
    if ($(this).attr("type") === "checkbox") {
        newValue = $(this).prop("checked");
        originalValue = ($(this).attr("original") === "true");
    } else {
        newValue = $(this).val();
        originalValue = $(this).attr("original");
    }

    if ($(this).attr("multiple") !== undefined) {
        newValue = newValue.join(",");
    }

    var hasChanged = ("true" === $(this).attr("hasChanged"));
    var action = $(this).attr("action");

    if (typeof originalValue === "undefined") { return; }
    if ("none" === action) { return; }

    if (newValue !== originalValue) {
        if (!hasChanged) {
            ++numChanged;
            if ("reconnect" === action) { ++numReconnect; }
            if ("reboot" === action) { ++numReboot; }
            if ("reload" === action) { ++numReload; }
        }
        $(this).attr("hasChanged", true);
    } else {
        if (hasChanged) {
            --numChanged;
            if ("reconnect" === action) { --numReconnect; }
            if ("reboot" === action) { --numReboot; }
            if ("reload" === action) { --numReload; }
        }
        $(this).attr("hasChanged", false);
    }

}

// -----------------------------------------------------------------------------
// Init & connect
// -----------------------------------------------------------------------------

function initUrls(root) {

    var paths = ["ws", "upgrade", "config", "auth"];

    urls["root"] = root;
    paths.forEach(function(path) {
        urls[path] = new URL(path, root);
        urls[path].protocol = root.protocol;
    });

    if (root.protocol == "https:") {
        urls.ws.protocol = "wss:";
    } else {
        urls.ws.protocol = "ws:";
    }

}

function connectToURL(url) {

    initUrls(url);

    fetch(urls.auth.href, {
        'method': 'GET',
        'cors': true,
        'credentials': 'same-origin'
    }).then(function(response) {
        // Nothing to do, reload page and retry
        if (response.status != 200) {
            doReload(5000);
            return;
        }
        // update websock object
        if (websock) { websock.close(); }
        websock = new WebSocket(urls.ws.href);
        websock.onmessage = function(evt) {
            var data = getJson(evt.data.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t"));
            if (data) {
                processData(data);
            }
        };
        websock.onclose = function(evt) {
            clearInterval(ws_pingpong);
            if (window.confirm("Connection lost with the device, click OK to refresh the page")) {
                $("#layout").toggle(false);
                window.location.reload();
            }
        }
        websock.onopen = function(evt) {
            ws_pingpong = setInterval(function() { sendAction("ping", {}); }, 5000);
        }
    }).catch(function(error) {
        console.log(error);
        doReload(5000);
    });

}

function connect(host) {
    if (!host.startsWith("http:") && !host.startsWith("https:")) {
        host = "http://" + host;
    }
    connectToURL(new URL(host));
}

function connectToCurrentURL() {
    connectToURL(new URL(window.location));
}

$(function() {

    initMessages();
    createCheckboxes();
    setInterval(function() { keepTime(); }, 1000);


    $("#menuLink").on("click", toggleMenu);
    $(".pure-menu-link").on("click", showPanel);
    $("progress").attr({ value: 0, max: 100 });

    $("#button-wifi-scan").on("click", doScan);

    $(".button-update").on("click", doUpdate);
    $(".button-update-password").on("click", doUpdatePassword);
    $(".button-generate-password").on("click", doGeneratePassword);
    $(".button-reboot").on("click", doReboot);
    $(".button-reconnect").on("click", doReconnect);
    $(".button-dbgcmd").on("click", doDebugCommand);
    $("input[name='dbgcmd']").enterKey(doDebugCommand);
    $(".button-dbg-clear").on("click", doDebugClear);
    $(".button-settings-backup").on("click", doBackup);
    $(".button-settings-restore").on("click", doRestore);
    $(".button-settings-factory").on("click", doFactoryReset);
    $("#uploader").on("change", onFileUpload);
    $(".button-upgrade").on("click", doUpgrade);

    //removeIf(!garland)
    $(".checkbox-garland-enable").on("change", function() {
        sendAction("garland_switch", {status: $(this).prop("checked") ? 1 : 0});
    });

    $(".slider-garland-brightness").on("change", function() {
        sendAction("garland_set_brightness", {brightness: $(this)[0].value});
    });

    $(".slider-garland-speed").on("change", function() {
        sendAction("garland_set_speed", {speed: $(this)[0].value});
    });

    $(".button-garland-set-default").on("click", function() {
        sendAction("garland_set_default", {});
    });
    //endRemoveIf(!garland)

    $(".button-apikey").on("click", generateAPIKey);
    $(".button-upgrade-browse").on("click", function() {
        $("input[name='upgrade']")[0].click();
        return false;
    });
    $("input[name='upgrade']").change(function (){
        var file = this.files[0];
        $("input[name='filename']").val(file.name);
    });
    $(".button-add-network").on("click", function() {
        $(".more", addNetwork()).toggle();
    });

    $(".button-add-switch-schedule").on("click", function() {
        addSchedule({schType: 1, schSwitch: -1});
    });
 
    $(".gpio-select").each(function(_, elem) {
        initSelectGPIO(elem)
    });

    $(document).on("change", "input", hasChanged);
    $(document).on("change", "select", hasChanged);

    $("textarea").on("dblclick", function() { this.select(); });

    resetOriginals();

    $(".group-settings").each(function() {
        groupSettingsObserver.observe(this, {childList: true});
    });

    // don't autoconnect when opening from filesystem
    if (window.location.protocol === "file:") {
        processData({"webMode": 0});
        return;
    }

    // Check host param in query string
    var search = new URLSearchParams(window.location.search),
        host = search.get("host");

    if (host !== null) {
        connect(host);
    } else {
        connectToCurrentURL();
    }

});
