/* ARM Diagram Studio View JavaScript */

function ARMDiagramStudioView(runtime, element, initData) {
    const $element = $(element);

    $element.find('#arm-display-name').val(initData.display_name || '');
    $element.find('#arm-weight').val(initData.weight || 1.0);
    $element.find('#arm-scenario-json').val(initData.scenario_json || '');

    $element.find('.arm-save-settings-btn').on('click', function() {
        const handlerUrl = runtime.handlerUrl(element, 'studio_submit');
        const data = {
            display_name: $element.find('#arm-display-name').val(),
            weight: parseFloat($element.find('#arm-weight').val()) || 1.0,
            scenario_json: $element.find('#arm-scenario-json').val()
        };

        // Basic client validation of JSON
        try {
            JSON.parse(data.scenario_json);
        } catch (e) {
            alert('Invalid JSON in Scenario Specification: ' + e.message);
            return;
        }

        runtime.notify('save', { state: 'start' });
        $.ajax({
            type: 'POST',
            url: handlerUrl,
            data: JSON.stringify(data),
            contentType: 'application/json; charset=utf-8',
            success: function(resp) {
                if (resp.success) {
                    runtime.notify('save', { state: 'end' });
                } else {
                    runtime.notify('error', { msg: resp.error || 'Failed to save settings.' });
                }
            },
            error: function() {
                runtime.notify('error', { msg: 'Failed to communicate with server.' });
            }
        });
    });

    $element.find('.arm-cancel-settings-btn').on('click', function() {
        runtime.notify('cancel');
    });
}
